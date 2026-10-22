import { defineSandbox } from "corax/sandbox";
import { JustBashSandbox } from "corax/sandbox/just-bash";

export const environment = JustBashSandbox.environment();
export default defineSandbox(() => environment.open());
