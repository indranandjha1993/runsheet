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
import { considerBody, moveBody, outcomeBody, publishBody } from "./routes.js";

export const policySurface: ServiceSurface = {
  service: "policy",
  operations: [
    {
      method: "POST",
      path: "/v1/policies",
      summary: "Publish a policy",
      scope: "policies:write",
      request: publishBody,
      replies: [created("the policy"), badRequest, unauthorized, forbidden],
    },
    {
      method: "POST",
      path: "/v1/policies/:id/events",
      summary: "Move a policy along its rollout",
      scope: "policies:write",
      request: moveBody,
      replies: [ok("the policy after the move"), badRequest, unauthorized, notFound, conflict],
    },
    {
      method: "GET",
      path: "/v1/policies/:id/calibration",
      summary: "How often the policy agreed with people",
      scope: "policies:read",
      replies: [ok("the calibration report"), unauthorized, notFound],
    },
    {
      method: "POST",
      path: "/v1/decisions",
      summary: "Ask a policy to decide",
      scope: "policies:write",
      request: considerBody,
      replies: [
        created("the decision, or nothing when the subject is outside the rollout"),
        badRequest,
        unauthorized,
      ],
    },
    {
      method: "POST",
      path: "/v1/decisions/:id/events",
      summary: "Record what happened to a decision",
      scope: "policies:write",
      request: outcomeBody,
      replies: [ok("the decision after the outcome"), badRequest, unauthorized, notFound, conflict],
    },
    {
      method: "GET",
      path: "/v1/decisions/:id/replayable",
      summary: "Whether the decision could be reproduced today",
      scope: "policies:read",
      replies: [ok("what is present and what is missing for a replay"), unauthorized, notFound],
    },
  ],
};
