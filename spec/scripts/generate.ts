import { publishTo } from "../dist/publish.js";

publishTo(new URL("../openapi.json", import.meta.url).pathname, "0.1.0");
