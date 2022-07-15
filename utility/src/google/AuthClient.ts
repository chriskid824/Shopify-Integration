import { GoogleAuth, IdTokenClient } from "google-auth-library";

var nexusApiClient: IdTokenClient = null;
const auth = new GoogleAuth();
const getClient = async () => {
    if (nexusApiClient) return nexusApiClient;
    nexusApiClient = await auth.getIdTokenClient(process.env.NEXUS_API_HOST);
    return nexusApiClient;
};

export { getClient }