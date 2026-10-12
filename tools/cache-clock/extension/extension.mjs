// Cache Clock — a Copilot CLI extension. See ../README.md.
import { joinSession } from "@github/copilot-sdk/extension";
import { attach } from "./lib/wiring.mjs";

await attach({ joinSession });
