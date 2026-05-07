export default function LegalDraftBanner() {
  return (
    <div className="mb-6 rounded-lg border border-yellow-700/50 bg-yellow-950/30 px-4 py-3 text-center">
      <p className="text-sm font-semibold text-yellow-400">
        DRAFT — PENDING LEGAL REVIEW
      </p>
      <p className="mt-1 text-xs text-yellow-600">
        This document contains placeholder content and has not been reviewed by legal counsel.
        It must be replaced with lawyer-reviewed text before public launch.
      </p>
    </div>
  );
}
