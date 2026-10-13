"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshArrAfterOrganization = refreshArrAfterOrganization;
const config_1 = require("../core/config");
function normalizeTitle(value) {
    return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function getSettings(kind) {
    return kind === "movie"
        ? { baseUrl: config_1.config.providerReconciliationRadarrUrl, apiKey: config_1.config.providerReconciliationRadarrApiKey, endpoint: "movie" }
        : { baseUrl: config_1.config.providerReconciliationSonarrUrl, apiKey: config_1.config.providerReconciliationSonarrApiKey, endpoint: "series" };
}
async function getEntity(target, settings) {
    if (!settings.baseUrl || !settings.apiKey)
        return undefined;
    const response = await fetch(settings.baseUrl.replace(/\/$/, "") + "/api/v3/" + settings.endpoint, {
        headers: { "X-Api-Key": settings.apiKey },
        signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
        throw new Error("ARR " + settings.endpoint + " lookup failed: HTTP " + response.status);
    const entities = await response.json();
    const title = normalizeTitle(target.title);
    return entities.find((entity) => normalizeTitle(entity.title || "") === title && (!target.year || !entity.year || entity.year === target.year));
}
async function getDetails(entity, settings) {
    if (!entity.id)
        return entity;
    const response = await fetch(settings.baseUrl.replace(/\/$/, "") + "/api/v3/" + settings.endpoint + "/" + entity.id, {
        headers: { "X-Api-Key": settings.apiKey },
        signal: AbortSignal.timeout(10000),
    });
    return response.ok ? await response.json() : entity;
}
async function submit(target) {
    const settings = getSettings(target.kind);
    if (!settings.baseUrl || !settings.apiKey)
        return;
    const entity = await getEntity(target, settings);
    const details = entity ? await getDetails(entity, settings) : undefined;
    const tracked = target.kind === "movie"
        ? Boolean(details?.hasFile || details?.path)
        : (details?.statistics?.episodeFileCount || 0) > 0;
    const command = tracked
        ? target.kind === "movie" ? { name: "RescanMovie", movieId: entity?.id } : { name: "RescanSeries", seriesId: entity?.id }
        : { name: target.kind === "movie" ? "DownloadedMoviesScan" : "DownloadedEpisodesScan", path: target.path, importMode: "Copy" };
    const response = await fetch(settings.baseUrl.replace(/\/$/, "") + "/api/v3/command", {
        method: "POST",
        headers: { "X-Api-Key": settings.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
        throw new Error("ARR command failed: HTTP " + response.status);
    const result = await response.json();
    console.log("[" + new Date().toISOString() + "][arr-refresh] queued " + target.kind + " " + (command.name || "unknown"), { title: target.title, commandId: result.id });
}
async function refreshArrAfterOrganization(targets) {
    const jobs = Array.from(targets, (target) => submit(target));
    const results = await Promise.allSettled(jobs);
    for (const result of results) {
        if (result.status === "rejected")
            console.warn("[" + new Date().toISOString() + "][arr-refresh] non-fatal refresh failure", { error: String(result.reason) });
    }
}
