import axios, { AxiosError } from "axios";

export interface Tags{
  name:string,
  description:string
}

export interface ModelRequest{
  user_id:string,
  body:string,
  subject:string,
  from:string
  tags : Tags[],
  sensitivity: string
}



export interface ModelResponse{
    category: string
    response_required: boolean
  
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
  timeout: 120000,
  headers: {
    "Content-Type": "application/json",
    
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

    console.log(request)

    const response = await apiClient.post<ModelResponse>(
      "/classify",

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
          "No response from model API. Please check if the service is running.",
        );
      } else {
        throw new Error(`Request setup error: ${axiosError.message}`);
      }
    }

    // Handle other errors
    throw error instanceof Error
      ? error
      : new Error("Unknown error during getting model api");
  }
}


export async function correctLabel(
  request: CorrectionRequest,
): Promise<CorrectionResponse> {
  try {
    if (!request.user_id) {
      throw new Error("user_id is required");
    }


    const response = await apiClient.post<CorrectionResponse>(
      "/correct",

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

