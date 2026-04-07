// Copyright 2021-2024 Adobe, Copyright 2025 The C2PA Contributors

import {
  selectDoNotTrain,
  selectEditsAndActivity,
  selectProducer,
  selectSocialAccounts,
  type C2paReadResult,
  type Ingredient,
  type Manifest,
  type ManifestStore,
  type Thumbnail,
  type TranslatedDictionaryCategory,
} from 'c2pa';
import debug from 'debug';
import { selectExif } from './exif';
import {
  MEDIA_CATEGORIES,
  SUPPORTED_FORMATS,
  isBrowserViewable,
  type MediaCategory,
} from './formats';
import { DEFAULT_LOCALE } from './i18n';
import { selectAppOrDeviceUsed } from './selectors/appOrDeviceUsed';
import { selectAutoDubInfo, type AutoDubInfo } from './selectors/autoDubInfo';
import {
  selectGenerativeInfo,
  selectModelsFromIngredient,
  type GenerativeInfo,
} from './selectors/generativeInfo';
import { selectReviewRatings } from './selectors/reviewRatings';
import {
  selectValidationResult,
  validationStatusByManifestLabel,
  type ManifestLabelValidationStatusMap,
  type ValidationStatusResult,
} from './selectors/validationResult';
import { selectSigningCertificateChain } from './certificateChain';
import { selectWeb3 } from './selectors/web3Info';
import { selectWebsite } from './selectors/website';
import { loadThumbnail, type ThumbnailInfo } from './thumbnail';
import type { Disposable } from './types';

const MANIFEST_STORE_MIME_TYPE = 'application/x-c2pa-manifest-store';
const dbg = debug('lib:asset');

// Extend c2pa module to include io.eqtylab.provenance assertion type
declare module 'c2pa' {
  interface ExtendedAssertions {
    'io.eqtylab.provenance': unknown;
  }
}

/**
 * Asset data required for the verify UI.
 */
export type AssetData = {
  id: string;
  children: string[];
  manifestData: ManifestData | null;
  thumbnail: ThumbnailInfo | null;
  mimeType: string;
  title: string | null;
  dataType: 'model' | null;
  validationResult: ValidationStatusResult | null;
  untrustedMessageOverride: string | null;
  unrecognizedLabelOverride: string | null;
  attestationCertificates:
    | {
        commonName: string;
        organizationalUnit: string | null;
        attestationTypes: string[];
      }[]
    | null;
  attestationManifest: unknown | null;
};

interface EditsAndActivityInferenceResponse {
  editsAndActivity: TranslatedDictionaryCategory[];
  hasInference: boolean;
}

export interface ClaimGeneratorDisplayInfo {
  label: string;
  icon: Thumbnail | null;
}

export type ManifestData = {
  claimGenerator: ClaimGeneratorDisplayInfo;
  date: Date | null;
  editsAndActivityForLocale: (
    locale: string | null,
  ) => Promise<EditsAndActivityInferenceResponse | null>;
  exif: ReturnType<typeof selectExif>;
  label: string | null;
  generativeInfo: GenerativeInfo | null;
  producer: string | null;
  reviewRatings: ReturnType<typeof selectReviewRatings>;
  signatureInfo: Manifest['signatureInfo'];
  doNotTrain: ReturnType<typeof selectDoNotTrain>;
  socialAccounts: ReturnType<typeof selectSocialAccounts>;
  web3Accounts: [string, string[]][];
  website: string | null;
  autoDubInfo: AutoDubInfo | null;
};

export type AssetDataMap = Record<string, AssetData>;

export type DisposableAssetDataMap = Disposable<{
  // Flattened map of asset data, keyed by asset ID
  assetMap: AssetDataMap;
}>;

export const ROOT_ID = '0';
const EQTY_ATTESTATION_MESSAGE = 'EQTY Attestation';
const EQTY_ATTESTED_LABEL = 'EQTY Attested';

interface EqtyAttestationInfo {
  message: string;
  label: string;
  certificates: {
    commonName: string;
    organizationalUnit: string | null;
    attestationTypes: string[];
  }[];
  manifest: unknown | null;
}

export function getMediaCategoryFromMimeType(mimeType: string): MediaCategory {
  const prefix = mimeType?.split('/')[0] as MediaCategory;

  return (
    SUPPORTED_FORMATS[mimeType]?.category ??
    (MEDIA_CATEGORIES.includes(prefix) ? prefix : 'unknown')
  );
}

export function getIngredientDataType(
  ingredient: Ingredient,
): AssetData['dataType'] {
  // Check if model
  if (selectModelsFromIngredient(ingredient).length > 0) {
    return 'model';
  }

  return null;
}

/**
 *
 * @param result Result from C2PA SDK
 * @returns Object containing a flattened map of asset data (keyed by asset ID), along with a disposer
 *
 * This will recursively process all nodes in the provenance tree, adding to (mutating) the `assetStore`
 * as the nodes are traversed. It also returns a disposer that should be called when this asset
 */
export async function resultToAssetMap({
  manifestStore,
  source,
}: C2paReadResult): Promise<DisposableAssetDataMap> {
  const assetMap: AssetDataMap = {};
  const disposers: (() => void)[] = [];
  const activeManifestLabel = manifestStore?.activeManifest?.label ?? '';
  const allLabels = Object.keys(manifestStore?.manifests ?? {});
  const runtimeValidationStatuses = manifestStore?.validationStatus
    ? validationStatusByManifestLabel(
        manifestStore?.validationStatus,
        allLabels,
        activeManifestLabel,
      )
    : {};

  dbg(
    'Runtime validation statuses by manifest label',
    runtimeValidationStatuses,
  );

  const activeManifestValidationResults =
    manifestStore?.validationResults.activeManifest;

  const rootValidationStatuses =
    runtimeValidationStatuses[activeManifestLabel] ?? [];
  const rootValidationResult = selectValidationResult(
    rootValidationStatuses,
    activeManifestValidationResults,
  );
  const { hasError, hasOtgp } = rootValidationResult ?? {};
  const isManifest = source.blob?.type === MANIFEST_STORE_MIME_TYPE;
  const id = ROOT_ID;
  const eqtyManifestAssertion = manifestStore?.activeManifest
    ? getEqtyManifestAssertion(manifestStore.activeManifest)
    : null;
  const eqtyAttestationInfo = await getEqtyAttestationInfo(
    source.blob,
    rootValidationResult,
    eqtyManifestAssertion,
  );

  dbg('resultToAssetMap input:', {
    manifestStore,
    source,
    rootValidationResult,
  });

  function dispose() {
    while (disposers.length) {
      disposers.pop()?.();
    }
  }

  if (!isManifest && (!manifestStore || hasError || hasOtgp)) {
    const thumbnail = await loadThumbnail(
      source.type,
      source.thumbnail.getUrl(),
    );

    if (thumbnail?.dispose) {
      disposers.push(thumbnail.dispose);
    }

    assetMap[id] = {
      // @TODO filename if none present?
      id,
      title: source.metadata.filename ?? null,
      thumbnail: thumbnail.info,
      mimeType: source.type,
      children: [],
      manifestData: null,
      dataType: null,
      validationResult: rootValidationResult,
      untrustedMessageOverride: eqtyAttestationInfo?.message ?? null,
      unrecognizedLabelOverride: eqtyAttestationInfo?.label ?? null,
      attestationCertificates: eqtyAttestationInfo?.certificates ?? null,
      attestationManifest: eqtyAttestationInfo?.manifest ?? null,
    };

    // Return early if we don't have a manifestStore
    if (!manifestStore || hasError) {
      return {
        assetMap,
        dispose,
      };
    }
  }

  // Start processing the provenance tree
  if (manifestStore && hasOtgp) {
    // Since the OTGP status is on the source, we don't show any issues on the asset underneath
    await manifestStoreToAssetData(
      manifestStore,
      selectValidationResult([]),
      runtimeValidationStatuses,
      id,
    );
  } else if (manifestStore && rootValidationResult) {
    // This conditional should always resolve to `true`, it's more to help TypeScript out
    await manifestStoreToAssetData(
      manifestStore,
      rootValidationResult,
      runtimeValidationStatuses,
      id,
    );
  }

  // Convert a manifest to an asset usable by the verify UI and add it to the map
  // Any processing here should be specific to keys on the root manifest
  async function manifestStoreToAssetData(
    manifestStore: ManifestStore,
    rootValidationResult: ValidationStatusResult,
    runtimeValidationStatuses: ManifestLabelValidationStatusMap,
    id: string,
  ): Promise<AssetData> {
    const { activeManifest: manifest } = manifestStore;

    // Attempt to use a thumbnail on the manifest if found
    let thumbnail = await loadThumbnail(
      manifest.thumbnail?.contentType,
      manifest.thumbnail?.getUrl(),
    );

    // If no thumbnail exists on the claim and we have a valid manifest,
    // we can use the source thumbnail if it is viewable by the browser
    if (
      !thumbnail.info &&
      ['valid', 'unrecognized'].includes(rootValidationResult.statusCode) &&
      (await isBrowserViewable(source.type))
    ) {
      thumbnail = await loadThumbnail(source.type, source.thumbnail?.getUrl());
    }

    const asset = {
      id,
      title: manifest.title,
      thumbnail: thumbnail.info,
      mimeType: manifest.format || source.type,
      children: await processIngredients(
        manifest.ingredients,
        runtimeValidationStatuses,
        id,
      ),
      manifestData: await getManifestData(manifest),
      dataType: null,
      validationResult: rootValidationResult,
      untrustedMessageOverride: eqtyAttestationInfo?.message ?? null,
      unrecognizedLabelOverride: eqtyAttestationInfo?.label ?? null,
      attestationCertificates: eqtyAttestationInfo?.certificates ?? null,
      attestationManifest: eqtyAttestationInfo?.manifest ?? null,
    };

    if (thumbnail?.dispose) {
      disposers.push(thumbnail.dispose);
    }

    assetMap[id] = asset;

    return asset;
  }

  // Convert an ingredient to an asset usable by the verify UI and add it to the map
  // Any processing here should be specific to keys on an ingredient
  async function ingredientToAssetData(
    ingredient: Ingredient,
    runtimeValidationStatuses: ManifestLabelValidationStatusMap,
    id: string,
  ): Promise<AssetData> {
    const ingredientManifestLabel = ingredient.manifest?.label;
    const thumbnail = await loadThumbnail(
      ingredient.thumbnail?.contentType,
      ingredient.thumbnail?.getUrl(),
    );

    const activeManifestValidationResults =
      ingredient.validationResults?.activeManifest;

    // Check validation result in the validationStatus supplied in the manifest
    let validationResult = selectValidationResult(
      ingredient.validationStatus,
      activeManifestValidationResults,
    );

    if (!validationResult.hasError && ingredientManifestLabel) {
      // If validationResult doesn't have an error, also check the runtime validation
      validationResult = selectValidationResult(
        runtimeValidationStatuses[ingredientManifestLabel] ?? [],
      );
    }

    const showChildren = validationResult.statusCode !== 'invalid';
    const asset = {
      id,
      title: ingredient.title,
      thumbnail: thumbnail.info,
      mimeType: ingredient.format,
      children: showChildren
        ? await processIngredients(
            ingredient.manifest?.ingredients ?? [],
            runtimeValidationStatuses,
            id,
          )
        : [],
      manifestData: await getManifestData(ingredient.manifest),
      dataType: getIngredientDataType(ingredient),
      validationResult,
      untrustedMessageOverride: null,
      unrecognizedLabelOverride: null,
      attestationCertificates: null,
      attestationManifest: null,
    };

    if (thumbnail?.dispose) {
      disposers.push(thumbnail.dispose);
    }

    assetMap[id] = asset;

    return asset;
  }

  // Get manifest data from a manifest (either a root manifest or an ingredient manifest)
  // Any processing that is common to both ingredients or active manifests should go here
  async function getManifestData(
    manifest: Manifest | null,
  ): Promise<ManifestData | null> {
    if (!manifest) {
      return null;
    }

    function formattedGeneratorInfo(
      claim_generator: Manifest['claimGeneratorInfo'][0],
    ) {
      const version = claim_generator?.version;
      claim_generator.version = version?.replace(/\([^()]*\)/g, '');

      return claim_generator;
    }

    const claimGeneratorInfo = manifest?.claimGeneratorInfo[0]
      ? formattedGeneratorInfo(manifest?.claimGeneratorInfo[0])
      : null;

    const claimGeneratorLabel =
      selectAppOrDeviceUsed(manifest) ??
      (claimGeneratorInfo?.name
        ? `${claimGeneratorInfo.name} ${claimGeneratorInfo?.version ?? ''}`
        : (selectAppOrDeviceUsed(manifest) ?? 'Unknown Generator'));

    const claimGenerator: ClaimGeneratorDisplayInfo = {
      label: claimGeneratorLabel,
      icon: claimGeneratorInfo?.icon ?? null,
    };

    function mapVerifiedIdentitiesToAuthors(manifest: Manifest) {
      if (manifest.verifiedIdentities.length > 0) {
        return manifest.verifiedIdentities
          .filter(
            (verifiedIdentity) => verifiedIdentity.type === 'cawg.social_media',
          )
          .map((verifiedIdentity) => ({
            '@id': verifiedIdentity.uri,
            '@type': 'Organization',
            identifier: verifiedIdentity.provider.id,
            name: verifiedIdentity.username,
          }));
      }

      return null;
    }

    return {
      date: manifest.signatureInfo?.time
        ? new Date(manifest.signatureInfo.time)
        : null,
      claimGenerator,
      signatureInfo: manifest.signatureInfo,
      producer: selectProducer(manifest)?.name ?? null,
      editsAndActivityForLocale: async (locale) => {
        const editsAndActivity = await selectEditsAndActivity(
          manifest,
          locale ?? DEFAULT_LOCALE,
        );

        if (editsAndActivity) {
          // Add inference information
          const [actionsAssertion] = manifest.assertions.get('c2pa.actions');
          const hasInference =
            !!actionsAssertion?.data?.metadata?.['com.adobe.inference'];

          // Remove anything with an "undefined" label. It should not occur, but this prevents us from displaying "undefined" to the user.
          const filteredEditsAndActivity = editsAndActivity.filter(
            (value) => !!value.label,
          );

          return {
            editsAndActivity: filteredEditsAndActivity,
            hasInference,
          };
        }

        return null;
      },
      socialAccounts:
        mapVerifiedIdentitiesToAuthors(manifest) ??
        selectSocialAccounts(manifest),
      generativeInfo: selectGenerativeInfo(manifest),
      exif: selectExif(manifest),
      label: manifest.label,
      doNotTrain: selectDoNotTrain(manifest),
      reviewRatings: selectReviewRatings(manifest),
      web3Accounts: selectWeb3(manifest),
      website: selectWebsite(manifest),
      autoDubInfo: selectAutoDubInfo(manifest),
    };
  }

  async function processIngredients(
    ingredients: Ingredient[],
    runtimeValidationStatuses: ManifestLabelValidationStatusMap,
    id: string,
  ): Promise<string[]> {
    const ingredientIds = ingredients.map(async (ingredient, idx) => {
      const ingredientId = `${id}.${idx}`;

      await ingredientToAssetData(
        ingredient,
        runtimeValidationStatuses,
        ingredientId,
      );

      return ingredientId;
    });

    return Promise.all(ingredientIds);
  }

  dbg('resultToAssetMap result:', {
    assetMap,
    activeManifestData: assetMap[ROOT_ID]?.manifestData,
  });

  return {
    assetMap,
    dispose,
  };
}

async function getEqtyAttestationInfo(
  blob: Blob | null,
  validationResult: ValidationStatusResult | null,
  eqtyManifestAssertion: unknown | null,
): Promise<EqtyAttestationInfo | null> {
  if (!blob || validationResult?.statusCode !== 'unrecognized') {
    return null;
  }

  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const chain = selectSigningCertificateChain(bytes);
    const root = chain?.at(-1);

    if (!root) {
      return null;
    }

    const hasDidKeySubject = [
      root.commonName ?? '',
      ...root.organizationalUnits,
    ]
      .filter(Boolean)
      .some((value) => value.startsWith('did:key:z'));

    if (!hasDidKeySubject || !chain) {
      return null;
    }

    return {
      message: EQTY_ATTESTATION_MESSAGE,
      label: EQTY_ATTESTED_LABEL,
      certificates: chain
        .filter((cert) => !!cert.commonName)
        .map((cert) => {
          const commonName = cert.commonName as string;

          return {
            commonName,
            organizationalUnit: cert.organizationalUnits[0] ?? null,
            attestationTypes: getEqtyDidRegistrationTypes(
              eqtyManifestAssertion,
              commonName,
            ),
          };
        }),
      manifest: eqtyManifestAssertion,
    };
  } catch {
    return null;
  }
}

function getEqtyManifestAssertion(manifest: Manifest): unknown | null {
  const assertions = manifest.assertions.get('io.eqtylab.provenance');

  if (!assertions || assertions.length === 0) {
    return null;
  }

  return assertions.map((assertion) => assertion?.data).find(Boolean) ?? null;
}

function getEqtyDidRegistrationTypes(manifest: unknown, did: string): string[] {
  if (!manifest || typeof manifest !== 'object') {
    return [];
  }

  const statements = (manifest as { statements?: Record<string, unknown> })
    .statements;

  if (!statements || typeof statements !== 'object') {
    return [];
  }

  const types = new Set<string>();

  for (const statement of Object.values(statements)) {
    if (!statement || typeof statement !== 'object') {
      continue;
    }

    const didRegistration = statement as {
      '@type'?: string;
      did?: string;
      vcomp?: { '@type'?: string } | null;
    };

    if (didRegistration['@type'] !== 'DidRegistration') {
      continue;
    }

    if (didRegistration.did !== did) {
      continue;
    }

    const type = didRegistration.vcomp?.['@type'];

    if (type) {
      types.add(type);
    }
  }

  return [...types];
}
