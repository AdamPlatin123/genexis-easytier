import { Event, listen } from "@tauri-apps/api/event";
import { type } from "@tauri-apps/plugin-os";
import { NetworkTypes } from "easytier-frontend-lib"
import { Utils } from "easytier-frontend-lib";
import { normalizeConfigSource } from './config_source'

interface StoredGuiConfig {
    config: NetworkTypes.NetworkConfig
    source?: unknown
}

const EVENTS = Object.freeze({
    SAVE_CONFIGS: 'save_configs',
    PRE_RUN_NETWORK_INSTANCE: 'pre_run_network_instance',
    POST_RUN_NETWORK_INSTANCE: 'post_run_network_instance',
    VPN_SERVICE_STOP: 'vpn_service_stop',
    DHCP_IP_CHANGED: 'dhcp_ip_changed',
    PROXY_CIDRS_UPDATED: 'proxy_cidrs_updated',
    EVENT_LAGGED: 'event_lagged',
});

// Most recent snapshot received from the Rust side via `save_configs`.
// Rust already emits this on every config change, so the persisted state in
// localStorage is normally up to date. We cache it so the close dialog's
// "保存当前网络配置" checkbox can force an explicit final flush.
let latestConfigsSnapshot: StoredGuiConfig[] = [];

function onSaveConfigs(event: Event<StoredGuiConfig[]>) {
    latestConfigsSnapshot = event.payload ?? [];
    console.log(`Received event '${EVENTS.SAVE_CONFIGS}': ${event.payload}`);
    localStorage.setItem(
        'networkList',
        JSON.stringify(event.payload.map(({ config, source }) => ({
            config: NetworkTypes.normalizeNetworkConfig(config),
            source: normalizeConfigSource(source),
        }))),
    );
}

/**
 * Returns the most recent network config snapshot pushed from the Rust side.
 */
export function getLatestConfigsSnapshot(): StoredGuiConfig[] {
    return latestConfigsSnapshot;
}

/**
 * Explicitly re-write the latest network config snapshot to localStorage.
 * Used by the close dialog's "保存当前网络配置" checkbox so the user has a
 * guaranteed, observable persist right before a full quit. Idempotent.
 */
export function flushConfigsToLocalStorage(): void {
    try {
        if (latestConfigsSnapshot.length === 0) {
            return;
        }
        localStorage.setItem(
            'networkList',
            JSON.stringify(latestConfigsSnapshot.map(({ config, source }) => ({
                config: NetworkTypes.normalizeNetworkConfig(config),
                source: normalizeConfigSource(source),
            }))),
        );
    } catch (e) {
        console.warn('flushConfigsToLocalStorage failed:', e);
    }
}

function normalizeInstanceIdPayload(payload: unknown): string {
    if (typeof payload === 'string') {
        return payload
    }

    if (payload && typeof payload === 'object') {
        const uuid = payload as Partial<Utils.UUID>
        if (
            typeof uuid.part1 === 'number'
            && typeof uuid.part2 === 'number'
            && typeof uuid.part3 === 'number'
            && typeof uuid.part4 === 'number'
        ) {
            return Utils.UuidToStr(uuid as Utils.UUID)
        }
    }

    if (payload == null) {
        return ''
    }

    const fallback = String(payload)
    return fallback === '[object Object]' ? '' : fallback
}

async function onPreRunNetworkInstance(event: Event<unknown>) {
    const instanceId = normalizeInstanceIdPayload(event.payload)
    console.log(`Received event '${EVENTS.PRE_RUN_NETWORK_INSTANCE}', raw payload:`, event.payload, 'normalized:', instanceId)
    if (type() === 'android') {
        await prepareVpnService(instanceId);
    }
}

async function onPostRunNetworkInstance(event: Event<unknown>) {
    const instanceId = normalizeInstanceIdPayload(event.payload)
    console.log(`Received event '${EVENTS.POST_RUN_NETWORK_INSTANCE}', raw payload:`, event.payload, 'normalized:', instanceId)
    if (type() === 'android') {
        await onNetworkInstanceChange(instanceId);
    }
}

async function onVpnServiceStop(event: Event<unknown>) {
    console.log(`Received event '${EVENTS.VPN_SERVICE_STOP}', raw payload:`, event.payload)
    await syncMobileVpnService();
}

async function onDhcpIpChanged(event: Event<unknown>) {
    const instanceId = normalizeInstanceIdPayload(event.payload)
    console.log(`Received event '${EVENTS.DHCP_IP_CHANGED}' for instance: ${instanceId}`);
    if (type() === 'android') {
        await onNetworkInstanceChange(instanceId);
    }
}

async function onProxyCidrsUpdated(event: Event<unknown>) {
    const instanceId = normalizeInstanceIdPayload(event.payload)
    console.log(`Received event '${EVENTS.PROXY_CIDRS_UPDATED}' for instance: ${instanceId}`);
    if (type() === 'android') {
        await onNetworkInstanceChange(instanceId);
    }
}

async function onEventLagged(event: Event<unknown>) {
    if (type() === 'android') {
        await onNetworkInstanceChange(normalizeInstanceIdPayload(event.payload));
    }
}

export async function listenGlobalEvents() {
    const unlisteners = [
        await listen(EVENTS.SAVE_CONFIGS, onSaveConfigs),
        await listen(EVENTS.PRE_RUN_NETWORK_INSTANCE, onPreRunNetworkInstance),
        await listen(EVENTS.POST_RUN_NETWORK_INSTANCE, onPostRunNetworkInstance),
        await listen(EVENTS.VPN_SERVICE_STOP, onVpnServiceStop),
        await listen(EVENTS.DHCP_IP_CHANGED, onDhcpIpChanged),
        await listen(EVENTS.PROXY_CIDRS_UPDATED, onProxyCidrsUpdated),
        await listen(EVENTS.EVENT_LAGGED, onEventLagged),
    ];

    return () => {
        unlisteners.forEach(unlisten => unlisten());
    };
}
