import type { Envelope } from "@runsheet/kernel";
import type { Hub } from "../domain/hub.js";
import type { Zone } from "../domain/zone.js";
import type { Lane } from "../domain/lane.js";

export interface NetworkRepository {
  saveHub(hub: Hub): Promise<void>;
  hubByCode(tenantId: string, code: string): Promise<Hub | undefined>;
  hubById(tenantId: string, id: string): Promise<Hub | undefined>;
  saveZone(tenantId: string, zone: Zone): Promise<void>;
  zonesFor(tenantId: string): Promise<Zone[]>;
  saveLane(tenantId: string, lane: Lane): Promise<void>;
  lanesFrom(tenantId: string, originHubId: string): Promise<Lane[]>;
  nextSequence(tenantId: string, aggregateId: string): Promise<number>;
}

export interface EventPublisher {
  publish(event: Envelope, payload: Record<string, unknown>, topic: string): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface Identifiers {
  next(): string;
}
