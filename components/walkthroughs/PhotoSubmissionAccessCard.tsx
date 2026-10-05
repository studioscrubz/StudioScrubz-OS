"use client";

import { useCallback, useEffect, useState } from "react";

const photoRequestMessage =
  "Hello,\n\nThank you for your interest in StudioScrubz.\n\nTo help us prepare an accurate assessment, please use the secure link below to upload clear photos of each area you would like us to review.\n\nPlease include wide photos of the full space as well as closer photos of any areas that may need special attention.\n\nOnce the photos are received, our team can review the property or project and prepare the next step in your estimate process.";

type LinkResponse = {
  url?: string | null;
  expiresAt?: string | null;
  submittedAt?: string | null;
  reused?: boolean;
  error?: string;
};

export function PhotoSubmissionAccessCard({
  walkthroughId,
  phone,
  status,
  submittedAt,
}: {
  walkthroughId: string;
  phone: string | null;
  status?: string;
  submittedAt?: string | null;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadExistingLink = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/walkthroughs/${walkthroughId}/photo-submission`,
        {
          method: "GET",
          cache: "no-store",
        },
      );

      const body = (await response.json()) as LinkResponse;

      if (!response.ok) {
        throw new Error(
          body.error || "Photo submission link could not be loaded.",
        );
      }

      setUrl(body.url ?? "");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Photo submission link could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [walkthroughId]);

  useEffect(() => {
    void loadExistingLink();
  }, [loadExistingLink]);

  async function createLink() {
    setBusy(true);
    setError(null);
    setCopied(false);

    try {
      const response = await fetch(
        `/api/walkthroughs/${walkthroughId}/photo-submission`,
        {
          method: "POST",
        },
      );

      const body = (await response.json()) as LinkResponse;

      if (!response.ok || !body.url) {
        throw new Error(
          body.error || "Photo submission link could not be created.",
        );
      }

      setUrl(body.url);
      return body.url;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Photo submission link could not be created.",
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function ensureLink() {
    if (url) {
      return url;
    }

    return createLink();
  }

  async function copy() {
    setError(null);
    setCopied(false);

    const secureUrl = await ensureLink();

    if (!secureUrl) {
      return;
    }

    try {
      if (!navigator.clipboard) {
        throw new Error();
      }

      await navigator.clipboard.writeText(secureUrl);
      setCopied(true);
    } catch {
      setError(
        "Copy is unavailable on this device. Select the secure link above to copy it manually.",
      );
    }
  }

  async function sendViaText() {
    setError(null);

    const secureUrl = await ensureLink();

    if (!secureUrl) {
      return;
    }

    if (!phone) {
      setError(
        "No phone number is available for this customer. Use Copy Link instead.",
      );
      return;
    }

    const message = `${photoRequestMessage}\n\n${secureUrl}\n\nIf you have any questions while uploading, feel free to contact us.\n\nNo mess. No stress.\n\nStudioScrubz`;

    try {
      window.location.href = `sms:${encodeURIComponent(
        phone,
      )}?body=${encodeURIComponent(message)}`;
    } catch {
      setError(
        "The messaging app could not be opened. Use Copy Link instead.",
      );
    }
  }

  return (
    <section className="rounded-2xl border border-[#d4af37]/40 bg-[#fffdf5] p-5">
      <h3 className="font-extrabold text-[#143d1a]">
        Customer Photo Submission
      </h3>

      <p className="mt-1 text-sm text-neutral-600">
        Send the customer a private, expiring link to upload photos for this
        property assessment.
      </p>

      <p className="mt-3 text-xs font-bold uppercase text-[#9a7a17]">
        Status:{" "}
        {submittedAt
          ? `Submitted ${new Date(submittedAt).toLocaleString()}`
          : status ?? "Not Sent"}
      </p>

      {loading ? (
        <p className="mt-3 text-sm text-neutral-500">
          Loading secure photo link...
        </p>
      ) : url ? (
        <div className="mt-3 rounded-lg border bg-white p-3">
          <p className="text-xs font-bold uppercase text-neutral-500">
            Secure Photo Link
          </p>

          <p className="mt-1 break-all text-sm">{url}</p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-neutral-600">
          No active photo submission link exists yet. One will be created when
          you copy or send the link.
        </p>
      )}

      {copied && (
        <p className="mt-3 text-sm font-bold text-[#143d1a]">
          Link copied.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm font-bold text-red-700">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || loading}
          onClick={() => void copy()}
          className="rounded-lg border border-[#143d1a] bg-white px-4 py-2.5 text-sm font-bold text-[#143d1a] disabled:opacity-50"
        >
          {busy ? "Preparing..." : "Copy Link"}
        </button>

        <button
          type="button"
          disabled={busy || loading}
          onClick={() => void sendViaText()}
          className="rounded-lg bg-[#143d1a] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? "Preparing..." : "Send via Text"}
        </button>
      </div>
    </section>
  );
}