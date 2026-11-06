import { localDev } from "@coraxjs/core/channels/auth";
import { coraxChannel } from "@coraxjs/core/channels/corax";

// Evals use the session API just like the terminal client.
export default coraxChannel({ auth: [localDev()] });
