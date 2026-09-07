import {
  badRequest,
  created,
  forbidden,
  notFound,
  ok,
  unauthorized,
  type ServiceSurface,
} from "@runsheet/api";
import { confirmBody, resolveBody } from "./routes.js";

export const addressSurface: ServiceSurface = {
  service: "address",
  operations: [
    {
      method: "POST",
      path: "/v1/addresses",
      summary: "Resolve a written address to a point",
      scope: "addresses:write",
      request: resolveBody,
      replies: [
        created("the resolved address and how much it is trusted"),
        badRequest,
        unauthorized,
        forbidden,
      ],
    },
    {
      method: "POST",
      path: "/v1/addresses/:id/confirm",
      summary: "Confirm a pin a driver stood on",
      scope: "addresses:write",
      request: confirmBody,
      replies: [ok("the address, with its confidence raised"), badRequest, unauthorized, notFound],
    },
    {
      method: "GET",
      path: "/v1/addresses/:id",
      summary: "Read a resolved address",
      scope: "addresses:read",
      replies: [ok("the address"), unauthorized, notFound],
    },
  ],
};
