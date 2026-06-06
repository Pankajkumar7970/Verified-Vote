import React, { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { FileText } from "lucide-react";

type PreviewKind = "supporting_doc" | "voter_id" | "selfie" | "appeal_doc";

export default function AdminSecurePreview({
  requestId,
  kind,
  alt,
  linkLabel,
  className = "w-full max-h-48 object-contain rounded border bg-gray-50",
}: {
  requestId: string;
  kind: PreviewKind;
  alt: string;
  linkLabel?: string;
  className?: string;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-file-preview", requestId, kind],
    queryFn: async () => {
      const res = await axios.get(
        `/api/admin/requests/${requestId}/preview/${kind}`,
        { responseType: "blob" },
      );
      const mime =
        (res.headers["content-type"] as string) || "application/octet-stream";
      return { url: URL.createObjectURL(res.data), mime };
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    return () => {
      if (data?.url) URL.revokeObjectURL(data.url);
    };
  }, [data?.url]);

  if (isLoading) {
    return <p className="text-sm text-gray-500">Loading preview…</p>;
  }
  if (isError || !data) {
    return <p className="text-sm text-gray-500">Preview not available</p>;
  }

  if (data.mime === "application/pdf") {
    return (
      <a
        href={data.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
      >
        <FileText className="w-4 h-4" />
        {linkLabel || "Open document"}
      </a>
    );
  }

  return (
    <a href={data.url} target="_blank" rel="noopener noreferrer">
      <img src={data.url} alt={alt} className={className} />
    </a>
  );
}
