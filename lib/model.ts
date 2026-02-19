import axios, { AxiosError } from 'axios';


export interface ClassifyRequest {
  user_id: string;       
  subject: string;
  sender: string;
  body: string;
  labels: string[];  
  use_llm:boolean     
}


export interface ClassifyResponse {
  label: string;
  confidence: number;
  margin: number;
  method: 'embedding' | 'llm_fallback';  
  all_scores: Record<string, number>;
}


export interface ApiErrorResponse {
  detail?: string;
  message?: string;
  error?: string;
}


const API_CONFIG = {
  baseURL: process.env.CLASSIFICATION_API_URL,
  timeout: 120000, 
  headers: {
    'Content-Type': 'application/json',
  },
};


const apiClient = axios.create(API_CONFIG);


export async function classifyEmail(
  request: ClassifyRequest
): Promise<ClassifyResponse> {
  try {
    
    if (!request.user_id) {
      throw new Error('user_id is required');
    }
    if (!request.labels || request.labels.length === 0) {
      throw new Error('labels array cannot be empty');
    }

    console.log(request);

    
    const labelMap = new Map<string, string>();
    request.labels.forEach(label => {
      labelMap.set(label.toLowerCase(), label);
    });


    
    const response = await apiClient.post<ClassifyResponse>(
      '/classify',
      {
        ...request,
        labels: request.labels.map(label => label.toLowerCase()),
      },
    );

    console.log('Model repsonse', '',response.data)
    

    
    const originalLabel = labelMap.get(response.data.label.toLowerCase()) || response.data.label;
    
    return {
      ...response.data,
      label: originalLabel,
      
    };
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
        
        throw new Error('No response from classification API. Please check if the service is running.');
      } else {
        
        throw new Error(`Request setup error: ${axiosError.message}`);
      }
    }
    
    // Handle other errors
    throw error instanceof Error ? error : new Error('Unknown error during classification');
  }
}