import type { DecisionScore, PRContext } from "@decisioncapture/shared";

const cssOnlyPattern = /\.(css|scss|sass|less|pcss)$/i;
const docsOnlyPattern = /(^|\/)(README|CHANGELOG|CONTRIBUTING|LICENSE)(\.[a-z]+)?$|\.mdx?$/i;

const primaryCategories = [
  "architecture",
  "security",
  "database",
  "api",
  "infrastructure",
  "dependencies",
  "performance",
  "collaboration"
] as const;

type PrimaryCategory = (typeof primaryCategories)[number];

const categoryPatterns: Record<PrimaryCategory, RegExp> = {
  architecture:
    /\b(architect(?:ure|ural)?|design|boundar(?:y|ies)|provider|adapter|workflow|policy|decision review|extract(?:ion|or)?|fallback|reopen(?:ing)?|modular|abstraction)\b/gi,
  security:
    /\b(auth(?:entication|orization)?|oauth|rbac|permission|token|secret|signature|security|encrypt(?:ion|ed)?|csrf|hmac)\b/gi,
  database:
    /\b(database|postgres(?:ql)?|prisma|schema|migration|sql|persistence|storage|transaction|index)\b/gi,
  api: /\b(api|endpoint|route|controller|webhook|openapi|swagger|contract|request|response)\b/gi,
  infrastructure:
    /\b(infrastructure|redis|bullmq|queue|worker|docker|kubernetes|k8s|helm|terraform|deploy(?:ment)?)\b/gi,
  dependencies:
    /\b(dependenc(?:y|ies)|package|library|framework|upgrade|version|lockfile|npm|pnpm|yarn)\b/gi,
  performance:
    /\b(performance|latency|cache|batch|throughput|optimi[sz](?:e|ation)|memory|profil(?:e|ing))\b/gi,
  collaboration:
    /\b(review(?:er|s|ed)?|approval|discussion|comment|collaboration|ownership|maintainer|author)\b/gi
};

const primaryCategorySet = new Set<string>(primaryCategories);

function countMatches(value: string | undefined, pattern: RegExp) {
  if (!value) {
    return 0;
  }

  return Math.min(value.match(pattern)?.length ?? 0, 4);
}

function textFor(context: PRContext) {
  return [
    context.title,
    context.description,
    context.diffSummary,
    ...(context.commits ?? []),
    ...(context.reviewComments ?? []),
    ...(context.labels ?? []),
    ...context.filesChanged
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function addSignal(
  condition: boolean,
  amount: number,
  category: string,
  reason: string,
  state: { score: number; categories: Set<string>; reasons: string[] }
) {
  if (!condition) {
    return;
  }

  state.score += amount;
  state.categories.add(category);
  state.reasons.push(reason);
}

export function scoreDecisionContext(context: PRContext, threshold = 35): DecisionScore {
  const files = context.filesChanged ?? [];
  const text = textFor(context);
  const state = {
    score: 0,
    categories: new Set<string>(),
    reasons: [] as string[]
  };

  addSignal(
    files.some((file) => /(^|\/)(prisma|migrations|schema)|\.(sql|prisma)$/i.test(file)),
    25,
    "database",
    "Database schema or migration files changed",
    state
  );

  addSignal(
    files.some((file) => /(api|routes?|controllers?|openapi|swagger)/i.test(file)) ||
      /\b(endpoint|route|api|breaking change|contract)\b/i.test(text),
    20,
    "api",
    "API surface or contract changed",
    state
  );

  addSignal(
    files.some((file) => /(modules?|services?|providers?|adapters?|workers?|queues?|architecture)/i.test(file)) ||
      /\b(architecture|service|provider|adapter|queue|worker|async)\b/i.test(text),
    20,
    "architecture",
    "Architecture or service boundary changed",
    state
  );

  addSignal(
    files.some((file) => /(package(-lock)?\.json|pnpm-lock|yarn\.lock|go\.mod|requirements|pyproject|Cargo\.toml)/i.test(file)),
    15,
    "dependencies",
    "Dependency manifest changed",
    state
  );

  addSignal(
    /\b(auth|oauth|token|secret|signature|permission|encrypt|security|csrf|hmac)\b/i.test(text),
    20,
    "security",
    "Security-sensitive behavior changed",
    state
  );

  addSignal(
    /\b(performance|latency|cache|index|batch|optimi[sz]e|throughput)\b/i.test(text),
    15,
    "performance",
    "Performance-related tradeoff mentioned",
    state
  );

  addSignal(
    files.some((file) => /(Dockerfile|docker-compose|k8s|helm|terraform|infra|deploy|redis|bullmq|queue)/i.test(file)) ||
      /\b(redis|docker|deploy|queue|bullmq|kubernetes|terraform)\b/i.test(text),
    15,
    "infrastructure",
    "Infrastructure or deployment behavior changed",
    state
  );

  addSignal(
    (context.reviewComments?.filter(Boolean).length ?? 0) > 0 ||
      (context.approvals?.filter(Boolean).length ?? 0) > 0,
    10,
    "collaboration",
    "Reviewer discussion or approvals exist",
    state
  );

  addSignal(
    files.length >= 8 || (context.diffSummary?.length ?? 0) > 500,
    10,
    "large-change",
    "Large diff likely contains meaningful context",
    state
  );

  if (files.length > 0 && files.every((file) => cssOnlyPattern.test(file))) {
    state.score -= 35;
    state.reasons.push("CSS-only change is usually not engineering decision memory");
  }

  if (files.length > 0 && files.every((file) => docsOnlyPattern.test(file))) {
    state.score -= 25;
    state.reasons.push("Documentation-only change is usually not engineering decision memory");
  }

  if (/\b(typo|formatting|prettier|rename only|color change)\b/i.test(text)) {
    state.score -= 20;
    state.reasons.push("Noise markers detected");
  }

  const normalizedScore = Math.max(0, Math.min(100, state.score));

  return {
    score: normalizedScore,
    threshold,
    shouldAnalyze: normalizedScore >= threshold,
    categories: [...state.categories],
    reasons: state.reasons
  };
}

export function resolvePrimaryCategory(context: PRContext, score: DecisionScore): PrimaryCategory {
  const candidates = score.categories.filter((category): category is PrimaryCategory =>
    primaryCategorySet.has(category)
  );
  const categories: PrimaryCategory[] = candidates.length > 0 ? candidates : ["architecture"];
  const weightedSources = [
    { value: context.title, weight: 6 },
    { value: context.description, weight: 3 },
    { value: context.labels?.join(" "), weight: 5 },
    { value: context.commits?.join(" "), weight: 2 },
    { value: context.filesChanged.join(" "), weight: 1.5 },
    { value: context.reviewComments?.join(" "), weight: 1 },
    { value: context.diffSummary, weight: 1 }
  ];

  return categories.reduce(
    (best, category) => {
      const intentScore = weightedSources.reduce(
        (total, source) => total + countMatches(source.value, categoryPatterns[category]) * source.weight,
        1
      );

      return intentScore > best.score ? { category, score: intentScore } : best;
    },
    { category: categories[0]!, score: Number.NEGATIVE_INFINITY }
  ).category;
}

export function resolveDecisionStatus(confidence: number, autoApproveConfidence: number) {
  return confidence >= autoApproveConfidence ? "APPROVED" : "PENDING";
}
