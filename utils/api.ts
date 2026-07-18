export const getApiUrl = () => {
  return import.meta.env.VITE_API_URL || 'http://localhost:3000';
};

export const fetchApi = async (endpoint: string, options: RequestInit = {}) => {
  const baseUrl = getApiUrl();
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.statusText}`);
  }

  return response.json();
};
