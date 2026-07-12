import axios, { AxiosError } from "axios";
import { throttled } from "./throttle";
import { bufferClassifyJob, pollForResult } from "@/lib/classify-batch";

export interface Tags{
  name:string,
  description:string,
  user_defined:boolean
}

export interface ModelRequest{
  user_id:string,
  bodySnippet:string,
  subject:string,
  from:string
  tags : Tags[],
  sensitivity: string
}



export interface ModelResponse{
    category: string
    response_required: boolean
    ai_summary?: string
    ai_action?: string
}

export interface CorrectionRequest{
  user_id:string,
  subject:string,
  body:string,
  correct_label:string,
  wrong_label?:string
}

export interface CorrectionResponse{
  status:string,
  message:string
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
  baseURL: process.env.CLASSIFICATION_API_URL,
  timeout: 240000,
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": process.env.AUTHORIZATION_KEY,
    
  },
};

const apiClient = axios.create(API_CONFIG);

export async function getModelResponse(
  request: ModelRequest,
): Promise<ModelResponse> {
  try {
    if (!request.user_id) {
      throw new Error("user_id is required");
    }

    const requestId = crypto.randomUUID();

    await bufferClassifyJob(requestId, request);

    return await pollForResult(requestId, 600_000);
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error("Unknown error during classification");
  }
}


export interface DeleteUserResponse {
  status: string;
  message: string;
}

export async function deleteUser(
  user_id: string,
): Promise<DeleteUserResponse> {
  try {
    if (!user_id) {
      throw new Error("user_id is required");
    }

    const response = await apiClient.post<DeleteUserResponse>(
      "/delete-user",
      { user_id },
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
          "No response from model API. Please check if the service is running.",
        );
      } else {
        throw new Error(`Request setup error: ${axiosError.message}`);
      }
    }

    throw error instanceof Error
      ? error
      : new Error("Unknown error during deleting user from classification model");
  }
}

export async function correctLabel(
  request: CorrectionRequest,
): Promise<CorrectionResponse> {
  try {
    if (!request.user_id) {
      throw new Error("user_id is required");
    }

    console.log(request)

    const response = await throttled("openai", () =>
      apiClient.post<CorrectionResponse>("/correct", request),
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
          "No response from model-correction API. Please check if the service is running.",
        );
      } else {
        throw new Error(`Request setup error: ${axiosError.message}`);
      }
    }

    // Handle other errors
    throw error instanceof Error
      ? error
      : new Error("Unknown error during getting model correction-api");
  }
}

