import { EmailIntent } from "@/context-engine/types";
import axios, { AxiosError } from "axios";

export interface DraftContextRequest{
  user_id:string,
  token:string,
  body:string,
  subject:string,
  sender_email:string,
  timezone:string,
  is_gmail:boolean
}

export interface Context{
  description:string
}

export interface DraftContextResponse{
  relationship_context:Context,
  topic_context:Context,
  behavioural_context:Context,
  overall_relevance:number,
  is_relevant:boolean,
  vectors_upserted:number,
  user_namespace:string,
  sender_email:string,
  keywords:       string[],
  mentionedDates: { raw: string; iso: string }[],
  intent:         EmailIntent
}

export interface ApiErrorResponse {
  detail?: string;
  message?: string;
  error?: string;
}


// const draftApiAuthorization =
//   process.env.CLASSIFICATION_API_BEARER_TOKEN
//     ? `Bearer ${process.env.CLASSIFICATION_API_BEARER_TOKEN}`
//     : undefined;
// ...(classificationApiAuthorization
    //   ? { Authorization: classificationApiAuthorization }
    //   : {}),

const API_CONFIG = {
  baseURL: process.env.DRAFT_API_URL,
  timeout: 120000,
  headers: {
    "Content-Type": "application/json",
    
  },
};

const apiClient = axios.create(API_CONFIG);

export async function getDraftContext(
  request: DraftContextRequest,
): Promise<DraftContextResponse> {
  try {
    if (!request.user_id) {
      throw new Error("user_id is required");
    }


    const response = await apiClient.post<DraftContextResponse>(
      "/context",

      request,
    );


    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<ApiErrorResponse>;

      if (axiosError.response) {
        const errorMessage =
          axiosError.response.data?.detail ||
          axiosError.response.data?.message ||
          axiosError.response.data?.error ||
          `API error: ${axiosError.response.status}`;

        throw new Error(errorMessage);
      } else if (axiosError.request) {
        throw new Error(
          "No response from draft API. Please check if the service is running.",
        );
      } else {
        throw new Error(`Request setup error: ${axiosError.message}`);
      }
    }

    // Handle other errors
    throw error instanceof Error
      ? error
      : new Error("Unknown error during getting draft context");
  }
}