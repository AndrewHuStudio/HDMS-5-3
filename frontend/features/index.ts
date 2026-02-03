import "./height-check/registry";
import "./setback-check/registry";
import "./sight-corridor/registry";
import "./fire-ladder/registry";

type WebpackRequireContext = {
  keys: () => string[];
  <T>(id: string): T;
};

// Auto-load any new feature registry modules to reduce merge conflicts.
const requireContext =
  typeof require !== "undefined"
    ? (require as {
        context?: (path: string, deep: boolean, filter: RegExp) => WebpackRequireContext;
      }).context
    : null;
if (typeof requireContext === "function") {
  const context = requireContext("./", true, /registry\.ts$/);
  context.keys().forEach((key) => {
    context(key);
  });
}
