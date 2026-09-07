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
import { bookBody, eventBody, labelBody } from "./routes.js";

export const ordersSurface: ServiceSurface = {
  service: "orders",
  operations: [
    {
      method: "POST",
      path: "/v1/consignments",
      summary: "Book a consignment",
      scope: "consignments:write",
      request: bookBody,
      replies: [created("the consignment as booked"), badRequest, unauthorized, forbidden],
    },
    {
      method: "POST",
      path: "/v1/consignments/:id/events",
      summary: "Record what happened to a consignment",
      scope: "consignments:write",
      request: eventBody,
      replies: [
        ok("the consignment after the event"),
        badRequest,
        unauthorized,
        notFound,
        conflict,
      ],
    },
    {
      method: "GET",
      path: "/v1/consignments",
      summary: "List the consignments that are still moving",
      scope: "consignments:read",
      replies: [ok("the open consignments, most recently changed first"), unauthorized],
    },
    {
      method: "GET",
      path: "/v1/consignments/:id",
      summary: "Read a consignment",
      scope: "consignments:read",
      replies: [ok("the consignment"), unauthorized, notFound],
    },
    {
      method: "POST",
      path: "/v1/consignments/:id/labels",
      summary: "Print labels, one per package",
      scope: "consignments:write",
      request: labelBody,
      replies: [
        ok("the labels, as data or as printer commands"),
        badRequest,
        unauthorized,
        notFound,
      ],
    },
  ],
};
