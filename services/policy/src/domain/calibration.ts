// Enough decisions for the number to mean something, and the precision below which a policy
// should be switched off. These two numbers are what an operator is really buying: they are the
// difference between automation you can defend and automation you hope is working.
const ENOUGH_TO_JUDGE = 100;
const PRECISION_FLOOR = 0.9;

export interface DecisionOutcome {
  readonly state: string;
}

export interface Calibration {
  readonly executed: number;
  readonly reversed: number;
  readonly failed: number;
  readonly rejected: number;
  /** Share of decisions that stood: nobody undid them, they did not fail, nobody said no. */
  readonly precision?: number;
  readonly enoughToJudge: boolean;
  readonly recommendation: "widen_rollout" | "keep_watching" | "roll_back";
}

// Shadow decisions changed nothing, so they are not judged here. A decision counts against the
// policy whether a person reversed it, it failed downstream, or a person refused it: in every
// case somebody had to deal with what the policy did.
export function calibrationOf(outcomes: readonly DecisionOutcome[]): Calibration {
  const counted = outcomes.filter((outcome) => outcome.state !== "shadow_recorded");
  const count = (state: string): number =>
    counted.filter((outcome) => outcome.state === state).length;

  const executed = count("executed");
  const reversed = count("reversed");
  const failed = count("failed");
  const rejected = count("rejected");
  const total = executed + reversed + failed + rejected;

  if (total === 0) {
    return {
      executed: 0,
      reversed: 0,
      failed: 0,
      rejected: 0,
      enoughToJudge: false,
      recommendation: "keep_watching",
    };
  }

  // States are terminal and exclusive: a decision that was reversed is not also counted as
  // executed. So the ones that stood are exactly the executed ones.
  const precision = executed / total;
  const enoughToJudge = total >= ENOUGH_TO_JUDGE;

  return {
    executed: executed + reversed + failed,
    reversed,
    failed,
    rejected,
    precision,
    enoughToJudge,
    recommendation: recommend(precision, enoughToJudge),
  };
}

function recommend(precision: number, enoughToJudge: boolean): Calibration["recommendation"] {
  if (precision < PRECISION_FLOOR) return "roll_back";
  return enoughToJudge ? "widen_rollout" : "keep_watching";
}
