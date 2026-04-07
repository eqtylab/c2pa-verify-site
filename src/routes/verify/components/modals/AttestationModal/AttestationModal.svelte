<!--
  Copyright 2021-2024 Adobe, Copyright 2025 The C2PA Contributors
-->

<script lang="ts">
  import Body from '$src/components/typography/Body.svelte';
  import BodyBold from '$src/components/typography/BodyBold.svelte';
  import Button from '$src/routes/verify/components/Button/Button.svelte';
  import { closeModal, openModal } from 'svelte-modals';
  import BaseModal from '../BaseModal/BaseModal.svelte';
  import LineageGraphModal from '../LineageGraphModal/LineageGraphModal.svelte';

  export let isOpen: boolean;
  export let certificates: {
    commonName: string;
    organizationalUnit: string | null;
    attestationTypes: string[];
  }[] = [];
  export let manifest: unknown | null = null;

  function handleDownloadManifest() {
    if (!manifest) {
      return;
    }

    const blob = new Blob([JSON.stringify(manifest, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'io.eqtylab.provenance.json';
    link.click();

    URL.revokeObjectURL(url);
  }

  function handleViewLineageGraph() {
    if (!manifest) {
      return;
    }

    openModal(LineageGraphModal, { manifest });
  }
</script>

{#if isOpen}
  <BaseModal label="EQTY Attestation">
    <div class="m-2 w-[min(42rem,calc(100vw-2rem))] rounded bg-white p-7">
      <div class="mb-5 border-b-2 pb-5">
        <BodyBold><h2>EQTY Attestation</h2></BodyBold>
      </div>

      <div class="space-y-5">
        <Body>Certificate chain common names</Body>

        <div class="space-y-0">
          {#each certificates as certificate, idx}
            <div class="flex gap-4">
              <div class="flex w-8 shrink-0 flex-col items-center pt-1">
                <div
                  class="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-900">
                  {idx + 1}
                </div>
                {#if idx < certificates.length - 1}
                  <div class="mt-2 h-10 w-0.5 bg-blue-200" />
                {/if}
              </div>

              <div class="grow pb-4">
                <div
                  class="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                  <div
                    class="mb-1 text-[0.7rem] font-bold uppercase tracking-[0.12em] text-blue-900">
                    {certificate.organizationalUnit ?? 'No OU'}
                  </div>
                  <Body>
                    <span class="break-all text-gray-900"
                      >{certificate.commonName}</span>
                  </Body>
                  {#if certificate.attestationTypes.length > 0}
                    <div class="mt-2 rounded-lg bg-white/70 px-3 py-2">
                      <div
                        class="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-blue-900">
                        Attestation Type{certificate.attestationTypes.length > 1
                          ? 's'
                          : ''}
                      </div>
                      <div class="break-all text-sm text-gray-900">
                        {#each certificate.attestationTypes as attestationType}
                          <div>{attestationType}</div>
                        {/each}
                      </div>
                    </div>
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        </div>

        {#if manifest}
          <div class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <Body>
              Download the embedded <span class="font-bold"
                >io.eqtylab.provenance</span>
              assertion as JSON.
            </Body>
          </div>
        {/if}
      </div>

      <div class="flex justify-end gap-2 pt-8">
        {#if manifest}
          <Button
            size="m"
            treatment="outline"
            variant="secondary"
            on:click={handleViewLineageGraph}>View Lineage Graph</Button>
          <Button
            size="m"
            treatment="outline"
            variant="secondary"
            on:click={handleDownloadManifest}
            >Download io.eqtylab.provenance</Button>
        {/if}
        <Button size="m" on:click={closeModal}>Close</Button>
      </div>
    </div>
  </BaseModal>
{/if}
