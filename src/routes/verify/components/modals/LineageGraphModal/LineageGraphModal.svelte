<!--
  Copyright 2021-2024 Adobe, Copyright 2025 The C2PA Contributors
-->

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Body from '$src/components/typography/Body.svelte';
  import BodyBold from '$src/components/typography/BodyBold.svelte';
  import Button from '$src/routes/verify/components/Button/Button.svelte';
  import { closeModal } from 'svelte-modals';
  import BaseModal from '../BaseModal/BaseModal.svelte';

  export let isOpen: boolean;
  export let manifest: unknown | null = null;

  let popupWindow: Window | null = null;
  let status = 'Opening explorer window...';
  let checkInterval: ReturnType<typeof setInterval> | null = null;

  const explorerOrigin =
    'https://explorer-git-feature-iframe-eqtylab.vercel.app';

  function setStatus(message: string) {
    status = message;
  }

  function openExplorerPopup() {
    const width = 1200;
    const height = 800;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;

    const url = `${explorerOrigin}/?appmode=iframe`;

    popupWindow = window.open(
      url,
      'LineageGraphExplorer',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=no,status=no`,
    );

    if (popupWindow) {
      setStatus('Explorer window opened. Waiting for it to be ready...');

      // Check if popup is closed
      checkInterval = setInterval(() => {
        if (popupWindow?.closed) {
          handlePopupClosed();
        }
      }, 500);

      // Try sending manifest after a delay in case ready message doesn't come
      setTimeout(() => {
        if (popupWindow && !popupWindow.closed && status.includes('Waiting')) {
          console.log('Sending manifest without ready signal');
          setStatus('Sending manifest to explorer...');
          sendManifest();
        }
      }, 2000);
    } else {
      setStatus(
        'Failed to open explorer window. Please check your popup blocker.',
      );
    }
  }

  function sendManifest() {
    if (!manifest || !popupWindow) {
      setStatus('No manifest or popup window not ready');
      console.log('Cannot send manifest:', {
        manifest: !!manifest,
        popupWindow: !!popupWindow,
      });

      return;
    }

    try {
      console.log('Sending manifest to popup:', manifest);
      popupWindow.postMessage(
        {
          type: 'explorer:load-manifest',
          manifest,
        },
        explorerOrigin,
      );
      setStatus('Manifest sent to explorer');

      // Try sending again after a short delay in case the first message was too early
      setTimeout(() => {
        if (popupWindow && !popupWindow.closed) {
          console.log('Sending manifest again (retry)');
          popupWindow.postMessage(
            {
              type: 'explorer:load-manifest',
              manifest,
            },
            explorerOrigin,
          );
        }
      }, 1000);
    } catch (error) {
      console.error('Error sending manifest:', error);
      setStatus(
        error instanceof Error ? error.message : 'Error sending manifest',
      );
    }
  }

  function handleMessage(event: MessageEvent) {
    console.log('Received message:', {
      origin: event.origin,
      data: event.data,
    });

    if (event.origin !== explorerOrigin) {
      console.log('Ignoring message from different origin:', event.origin);

      return;
    }

    if (event.data?.type === 'explorer:ready') {
      console.log('Explorer is ready, sending manifest');
      setStatus('Explorer ready. Sending manifest...');
      sendManifest();

      return;
    }

    if (event.data?.type === 'explorer:manifest-loaded') {
      setStatus('Explorer loaded successfully. You can close this dialog.');

      return;
    }

    if (event.data?.type === 'explorer:manifest-error') {
      console.error('Explorer error:', event.data.error);
      setStatus(`Explorer error: ${event.data.error}`);
    }
  }

  function handlePopupClosed() {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }

    popupWindow = null;
    closeModal();
  }

  function handleClose() {
    if (popupWindow && !popupWindow.closed) {
      popupWindow.close();
    }

    handlePopupClosed();
  }

  onMount(() => {
    window.addEventListener('message', handleMessage);
    openExplorerPopup();

    return () => {
      window.removeEventListener('message', handleMessage);

      if (checkInterval) {
        clearInterval(checkInterval);
      }
    };
  });

  onDestroy(() => {
    if (checkInterval) {
      clearInterval(checkInterval);
    }
  });
</script>

{#if isOpen}
  <BaseModal label="Lineage Graph">
    <div class="m-2 w-[min(32rem,calc(100vw-2rem))] rounded bg-white p-7">
      <div class="mb-5 border-b-2 pb-5">
        <BodyBold><h2>Lineage Graph Explorer</h2></BodyBold>
      </div>

      <div class="space-y-4">
        <Body>
          The lineage graph is opening in a new window. Please ensure popups are
          allowed for this site.
        </Body>

        {#if status}
          <div class="rounded-lg bg-blue-50 p-4">
            <div class="text-sm font-medium text-blue-900">Status</div>
            <div class="mt-1 text-sm text-blue-700">{status}</div>
          </div>
        {/if}

        <div class="rounded-lg bg-gray-50 p-4">
          <Body>
            <ul class="list-inside list-disc space-y-1 text-sm text-gray-700">
              <li>The explorer will load your manifest automatically</li>
              <li>You can interact with the graph in the popup window</li>
              <li>Close the popup window when you're done</li>
            </ul>
          </Body>
        </div>
      </div>

      <div class="flex justify-end gap-2 pt-8">
        {#if popupWindow && !popupWindow.closed}
          <Button
            size="m"
            treatment="outline"
            variant="secondary"
            on:click={sendManifest}>
            Send Manifest
          </Button>
        {/if}
        <Button
          size="m"
          treatment="outline"
          variant="secondary"
          on:click={openExplorerPopup}>
          {popupWindow && !popupWindow.closed ? 'Focus' : 'Open'} Explorer
        </Button>
        <Button size="m" on:click={handleClose}>Close</Button>
      </div>
    </div>
  </BaseModal>
{/if}
