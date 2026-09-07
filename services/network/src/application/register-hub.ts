import { envelope } from "@runsheet/kernel";
import { hub, type Hub } from "../domain/hub.js";
import type { Clock, EventPublisher, Identifiers, NetworkRepository } from "./ports.js";

export interface RegisterHubDeps {
  readonly repository: NetworkRepository;
  readonly publisher: EventPublisher;
  readonly clock: Clock;
  readonly ids: Identifiers;
}

export interface RegisterHubCommand {
  readonly tenantId: string;
  readonly code: string;
  readonly name: string;
  readonly countryCode: string;
  readonly timeZone: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly opensMinutesOfDay: number;
  readonly closesMinutesOfDay: number;
}

function detailsOf(candidate: Hub): Record<string, unknown> {
  return {
    code: candidate.code,
    name: candidate.name,
    country_code: candidate.countryCode,
    time_zone: candidate.timeZone,
    latitude: candidate.location.latitude,
    longitude: candidate.location.longitude,
    opens_minutes_of_day: candidate.opensMinutesOfDay,
    closes_minutes_of_day: candidate.closesMinutesOfDay,
  };
}

function proposedHub(command: RegisterHubCommand, id: string): Hub {
  return hub({
    id,
    tenantId: command.tenantId,
    code: command.code,
    name: command.name,
    countryCode: command.countryCode,
    timeZone: command.timeZone,
    location: { latitude: command.latitude, longitude: command.longitude },
    opensMinutesOfDay: command.opensMinutesOfDay,
    closesMinutesOfDay: command.closesMinutesOfDay,
  });
}

export async function registerHub(
  deps: RegisterHubDeps,
  command: RegisterHubCommand,
): Promise<Hub> {
  const candidate = proposedHub(command, deps.ids.next());
  const existing = await deps.repository.hubByCode(candidate.tenantId, candidate.code);
  if (existing !== undefined) {
    throw new Error(`a hub with code ${candidate.code} already exists`);
  }

  await deps.repository.saveHub(candidate);

  const at = deps.clock.now();
  const event = envelope({
    tenantId: candidate.tenantId,
    aggregateType: "hub",
    aggregateId: candidate.id,
    sequence: await deps.repository.nextSequence(candidate.tenantId, candidate.id),
    type: "hub.created",
    version: 1,
    occurredAt: at,
    recordedAt: at,
    source: "api",
  });

  await deps.publisher.publish(event, detailsOf(candidate), "network");

  return candidate;
}
