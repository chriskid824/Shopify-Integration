import { CostExtension } from "../../index.d";

export function exceedsMaximumCost(cost: CostExtension) {
  const {
    requestedQueryCost,
    actualQueryCost,
    throttleStatus: { maximumAvailable },
  } = cost;
  const requested = actualQueryCost || requestedQueryCost;

  return requested > maximumAvailable;
}