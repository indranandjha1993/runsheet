import {
  badRequest,
  created,
  forbidden,
  ok,
  unauthorized,
  type ServiceSurface,
} from "@runsheet/api";
import { hubBody } from "./routes.js";

export const networkSurface: ServiceSurface = {
  service: "network",
  operations: [
    {
      method: "POST",
      path: "/v1/hubs",
      summary: "Register a hub",
      scope: "network:write",
      request: hubBody,
      replies: [
        created("the hub, with the identifier the rest of the platform uses"),
        badRequest,
        unauthorized,
        forbidden,
      ],
    },
    {
      method: "GET",
      path: "/v1/serviceability",
      summary: "Ask whether a point can be served",
      scope: "network:read",
      replies: [
        ok("whether the point is serviceable, and by which zone"),
        badRequest,
        unauthorized,
      ],
    },
  ],
};
