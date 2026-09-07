import {
  badRequest,
  conflict,
  created,
  forbidden,
  notFound,
  ok,
  unauthorized,
  type ServiceSurface,
} from "@runsheet/api";
import { actionBody, eventBody, planBody, proofBody, scanInBody, scanOutBody } from "./routes.js";
import { syncBody } from "./sync-routes.js";

export const executionSurface: ServiceSurface = {
  service: "execution",
  operations: [
    {
      method: "POST",
      path: "/v1/runs",
      summary: "Plan a run with its stops",
      scope: "runs:write",
      request: planBody,
      replies: [created("the run and its stops"), badRequest, unauthorized, forbidden],
    },
    {
      method: "POST",
      path: "/v1/runs/:id/events",
      summary: "Move a run through its day",
      scope: "runs:write",
      request: eventBody,
      replies: [ok("the run after the event"), badRequest, unauthorized, notFound, conflict],
    },
    {
      method: "POST",
      path: "/v1/runs/:id/actions",
      summary: "Record the outcome of one stop action",
      scope: "runs:write",
      request: actionBody,
      replies: [ok("the run after the action"), badRequest, unauthorized, notFound, conflict],
    },
    {
      method: "GET",
      path: "/v1/runs",
      summary: "List the runs still open at a hub on a day",
      scope: "runs:read",
      replies: [ok("the runs and their stops"), badRequest, unauthorized],
    },
    {
      method: "GET",
      path: "/v1/runs/:id",
      summary: "Read a run",
      scope: "runs:read",
      replies: [ok("the run"), unauthorized, notFound],
    },
    {
      method: "POST",
      path: "/v1/proofs",
      summary: "Capture proof of an attempt",
      scope: "runs:write",
      request: proofBody,
      replies: [
        created("the proof, and whether it satisfies the requirement"),
        badRequest,
        unauthorized,
      ],
    },
    {
      method: "POST",
      path: "/v1/hub-scans/in",
      summary: "Scan a parcel into a hub",
      scope: "runs:write",
      request: scanInBody,
      replies: [
        created("the scan, with any exception it raised"),
        badRequest,
        unauthorized,
        forbidden,
      ],
    },
    {
      method: "POST",
      path: "/v1/hub-scans/out",
      summary: "Scan a parcel out to a run",
      scope: "runs:write",
      request: scanOutBody,
      replies: [created("the scan"), badRequest, unauthorized, conflict],
    },
    {
      method: "POST",
      path: "/v1/sync/batches",
      summary: "Take a shift's work off a handset in one call",
      scope: "runs:write",
      request: syncBody,
      replies: [
        ok("what happened to each entry, and any media the server still wants"),
        badRequest,
        unauthorized,
        forbidden,
      ],
    },
    {
      method: "GET",
      path: "/v1/hub-scans",
      summary: "List every hub scan of one parcel",
      scope: "runs:read",
      replies: [ok("the scans, oldest first"), badRequest, unauthorized],
    },
  ],
};
