import { InferRequestType } from "hono";
import { useMutation } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

export interface ChatAttachment {
  key: string
  filename: string
  mimeType: string
}

export interface ChatResponse {
  response: string
  attachments: ChatAttachment[]
}

type RequestType = InferRequestType<
  (typeof client.api.chat)["$post"]
>["json"];

export const useChat = () => {
  return useMutation<ChatResponse, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api.chat["$post"]({ json });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          (errorData as { message?: string }).message ||
            "Failed to process chat query",
        );
      }

      return response.json();
    },
    onError: (error) => {
      console.error("[useChat]", error);
      toast.error(error.message || "Failed to process chat query");
    },
  });
};
