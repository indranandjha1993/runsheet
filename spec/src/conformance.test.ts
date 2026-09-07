import { describe, expect, it } from "vitest";
import { addressRoutes } from "@runsheet/address";
import { exceptionsRoutes } from "@runsheet/exceptions";
import { executionRoutes } from "@runsheet/execution";
import { identityRoutes } from "@runsheet/identity";
import { linehaulRoutes } from "@runsheet/linehaul";
import { moneyRoutes } from "@runsheet/money";
import { networkRoutes } from "@runsheet/network";
import { ordersRoutes } from "@runsheet/orders";
import { planningRoutes } from "@runsheet/planning";
import { policyRoutes } from "@runsheet/policy";
import { promiseRoutes } from "@runsheet/promise";
import { SURFACES } from "./surfaces.js";

// The factories only close over their dependencies; nothing is called, so nothing is needed.
const nothing = {} as never;

const REGISTERED: Record<string, { method: string; path: string }[]> = {
  identity: identityRoutes(nothing),
  network: networkRoutes(nothing),
  address: addressRoutes(nothing),
  orders: ordersRoutes(nothing),
  execution: executionRoutes(nothing),
  linehaul: linehaulRoutes(nothing),
  planning: planningRoutes(nothing),
  promise: promiseRoutes(nothing),
  exceptions: exceptionsRoutes(nothing),
  money: moneyRoutes(nothing),
  policy: policyRoutes(nothing),
};

const signature = (route: { method: string; path: string }): string =>
  `${route.method} ${route.path}`;

describe("the published specification and the running services", () => {
  it("describes every service that has routes", () => {
    expect(SURFACES.map((surface) => surface.service).sort()).toEqual(
      Object.keys(REGISTERED).sort(),
    );
  });

  for (const surface of SURFACES) {
    it(`describes exactly the routes ${surface.service} registers`, () => {
      const described = surface.operations.map(signature).sort();
      const registered = (REGISTERED[surface.service] ?? []).map(signature).sort();

      expect(described).toEqual(registered);
    });
  }

  it("names a scope on every route except the ones meant to be open", () => {
    const open = SURFACES.flatMap((surface) =>
      surface.operations.filter((operation) => operation.scope === undefined).map(signature),
    );

    expect(open.sort()).toEqual([
      "GET /track/:token",
      "GET /v1/callers/current",
      "GET /v1/tenants/:id",
      "GET /v1/tenants/:id/keys",
      "POST /v1/keys",
      "POST /v1/keys/:id/revoke",
      "POST /v1/tenants",
    ]);
  });

  it("says what a caller gets back on every route", () => {
    for (const surface of SURFACES) {
      for (const operation of surface.operations) {
        expect(operation.replies.length).toBeGreaterThan(0);
        // A summary is a sentence somebody can read, not a restatement of the path.
        expect(operation.summary).toMatch(/^[A-Z][^/]* [a-z]/);
      }
    }
  });

  it("tells an authenticated route's caller what happens without a credential", () => {
    const guarded = SURFACES.flatMap((surface) =>
      surface.operations.filter((operation) => operation.scope !== undefined),
    );

    for (const operation of guarded) {
      expect(operation.replies.map((reply) => reply.status)).toContain(401);
    }
  });
});
