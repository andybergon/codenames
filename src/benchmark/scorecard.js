export const BENCHMARK_REPORT_SCHEMA_VERSION = 3;

export function validateBenchmarkReport(report) {
  if (report?.schemaVersion !== BENCHMARK_REPORT_SCHEMA_VERSION) {
    throw new Error(
      `Expected benchmark report schema ${BENCHMARK_REPORT_SCHEMA_VERSION}.`,
    );
  }
  if (!report.baseline || !Array.isArray(report.candidates)) {
    throw new Error(
      "Benchmark report must include baseline and candidates roots.",
    );
  }
  if (
    report.baseline.configurationContract !== "canonical-v1" ||
    !report.baseline.configuration ||
    !report.baseline.configurationFingerprint
  ) {
    throw new Error(
      "Benchmark report baseline must use the canonical configuration contract.",
    );
  }
  if (!report.summary || !report.evidenceFamilies?.humanAlignment) {
    throw new Error(
      "Benchmark report must include presentation summary and evidence families.",
    );
  }
  return report;
}

export function benchmarkRows(report) {
  validateBenchmarkReport(report);
  const summaryById = new Map(
    report.summary.candidates.map((candidate) => [
      candidate.id,
      candidate,
    ]),
  );
  return report.candidates.map((candidate) => ({
    ...candidate,
    summary: summaryById.get(candidate.id),
  }));
}

export function humanAlignmentSlices(report, candidateId) {
  validateBenchmarkReport(report);
  return report.evidenceFamilies.humanAlignment.slices.filter(
    (slice) => slice.candidateId === candidateId,
  );
}
