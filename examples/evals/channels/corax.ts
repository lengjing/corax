import { localDev } from "corax/channels/auth";
import { coraxChannel } from "corax/channels/corax";

// Evals use the session API just like the terminal client.
export default coraxChannel({ auth: [localDev()] });
