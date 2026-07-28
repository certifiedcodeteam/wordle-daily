import { clientFor, handleFunctionError } from "../../../shared/platform.js";
import { setPartyReady } from "../../../shared/party-service.js";

Deno.serve(async (req) => {
  try { return Response.json(await setPartyReady(clientFor(req), await req.json())); }
  catch (error) { return handleFunctionError(error); }
});
