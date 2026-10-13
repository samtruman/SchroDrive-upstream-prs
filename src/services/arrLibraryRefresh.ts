import { config } from "../core/config";

export type ArrRefreshKind = "movie" | "tv";

export interface ArrRefreshTarget {
  kind: ArrRefreshKind;
  path: string;
  title: string;
  year?: number;
}

interface ArrEntity {
  id?: number;
  title?: string;
  year?: number;
  hasFile?: boolean;
  path?: string;
  statistics?: { episodeFileCount?: number };
}

function normalizeTitle(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function getSettings(kind: ArrRefreshKind): { baseUrl: string; apiKey: string; endpoint: string } {
  return kind === "movie"
    ? { baseUrl: config.providerReconciliationRadarrUrl, apiKey: config.providerReconciliationRadarrApiKey, endpoint: "movie" }
    : { baseUrl: config.providerReconciliationSonarrUrl, apiKey: config.providerReconciliationSonarrApiKey, endpoint: "series" };
}

async function getEntity(target: ArrRefreshTarget, settings: ReturnType<typeof getSettings>): Promise<ArrEntity | undefined> {
  if (!settings.baseUrl || !settings.apiKey) return undefined;
  const response = await fetch(settings.baseUrl.replace(/\/$/, "") + "/api/v3/" + settings.endpoint, {
    headers: { "X-Api-Key": settings.apiKey },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("ARR " + settings.endpoint + " lookup failed: HTTP " + response.status);
  const entities = await response.json() as ArrEntity[];
  const title = normalizeTitle(target.title);
  return entities.find((entity) => normalizeTitle(entity.title || "") === title && (!target.year || !entity.year || entity.year === target.year));
}

async function getDetails(entity: ArrEntity, settings: ReturnType<typeof getSettings>): Promise<ArrEntity> {
  if (!entity.id) return entity;
  const response = await fetch(settings.baseUrl.replace(/\/$/, "") + "/api/v3/" + settings.endpoint + "/" + entity.id, {
    headers: { "X-Api-Key": settings.apiKey },
    signal: AbortSignal.timeout(10000),
  });
  return response.ok ? await response.json() as ArrEntity : entity;
}

async function submit(target: ArrRefreshTarget): Promise<void> {
  const settings = getSettings(target.kind);
  if (!settings.baseUrl || !settings.apiKey) return;
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
  if (!response.ok) throw new Error("ARR command failed: HTTP " + response.status);
  const result = await response.json() as { id?: number };
  console.log("[" + new Date().toISOString() + "][arr-refresh] queued " + target.kind + " " + (command.name || "unknown"), { title: target.title, commandId: result.id });
}

export async function refreshArrAfterOrganization(targets: Iterable<ArrRefreshTarget>): Promise<void> {
  const jobs = Array.from(targets, (target) => submit(target));
  const results = await Promise.allSettled(jobs);
  for (const result of results) {
    if (result.status === "rejected") console.warn("[" + new Date().toISOString() + "][arr-refresh] non-fatal refresh failure", { error: String(result.reason) });
  }
}
