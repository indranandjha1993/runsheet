import {
  badRequest,
  created,
  notFound,
  ok,
  unauthorized,
  type ServiceSurface,
} from "@runsheet/api";
import { etaBody, promiseBody, settleBody } from "./routes.js";

export const promiseSurface: ServiceSurface = {
  service: "promise",
  operations: [
    {
      method: "POST",
      path: "/v1/promises",
      summary: "Promise a delivery window",
      scope: "consignments:write",
      request: promiseBody,
      replies: [created("the promise and its tracking token"), badRequest, unauthorized],
    },
    {
      method: "POST",
      path: "/v1/promises/:id/eta",
      summary: "Revise the estimate on a promise",
      scope: "consignments:write",
      request: etaBody,
      replies: [ok("the promise after the revision"), badRequest, unauthorized, notFound],
    },
    {
      method: "POST",
      path: "/v1/promises/:id/settle",
      summary: "Settle a promise as kept or missed",
      scope: "consignments:write",
      request: settleBody,
      replies: [ok("the settled promise"), badRequest, unauthorized, notFound],
    },
    {
      method: "GET",
      path: "/track/:token",
      summary: "Follow a parcel with no credential at all",
      replies: [ok("what the recipient is allowed to see"), notFound],
    },
  ],
};
