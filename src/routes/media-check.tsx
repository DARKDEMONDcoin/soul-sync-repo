import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { PostMediaGallery, type PostMedia } from "@/components/app/PostMediaGallery";

export const Route = createFileRoute("/media-check")({ component: Check });

function Check() {
  const [media, setMedia] = useState<PostMedia[]>([
    { url: "https://picsum.photos/id/1011/1200/900", kind: "image", label: "صورة ١" },
    { url: "https://picsum.photos/id/1025/1200/1600", kind: "image", label: "صورة ٢" },
    { url: "https://picsum.photos/id/1035/1600/900", kind: "image", label: "صورة ٣" },
  ]);
  return (
    <div dir="rtl" className="mx-auto max-w-2xl p-4">
      <div className="post-publisher-media-first">
        <PostMediaGallery
          media={media}
          onRemove={(url) => setMedia((m) => m.filter((x) => x.url !== url))}
        />
      </div>
    </div>
  );
}
