export interface StrapiConfig {
  url: string;
  apiKey: string;
}

export function getStrapiConfig(): StrapiConfig {
  const url = import.meta.env.VITE_STRAPI_URL;
  const apiKey = import.meta.env.VITE_STRAPI_API_KEY;
  if (!url || !apiKey) {
    throw new Error('Strapi URL or API Key is missing. Please set VITE_STRAPI_URL and VITE_STRAPI_API_KEY in your .env file.');
  }
  // Strip trailing slash so we can append paths cleanly
  return { url: url.replace(/\/+$/, ''), apiKey };
}

const ENDPOINT = '/semester-planner-sync';

export async function fetchStrapiData(): Promise<any[]> {
  const config = getStrapiConfig();
  const response = await fetch(`${config.url}${ENDPOINT}`, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
  });
  if (!response.ok) {
    if (response.status === 404) return []; // Might not be created yet
    throw new Error(`Failed to fetch from Strapi: ${response.statusText}`);
  }
  const json = await response.json();
  
  // Strapi 4 structure: json.data.attributes (assuming the field is called 'data')
  // Try to find the array field dynamically
  const attributes = json.data?.attributes || json.data || {};
  if (Array.isArray(attributes)) return attributes;
  for (const key of Object.keys(attributes)) {
    if (Array.isArray(attributes[key])) {
      return attributes[key];
    }
  }
  return [];
}

export async function updateStrapiData(data: any[]): Promise<void> {
  const config = getStrapiConfig();
  
  // Try to determine the field name by fetching first
  const response = await fetch(`${config.url}${ENDPOINT}`, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
  });
  
  let fieldName = 'data'; // Fallback
  if (response.ok) {
    const json = await response.json();
    const attributes = json.data?.attributes || json.data || {};
    for (const key of Object.keys(attributes)) {
      if (Array.isArray(attributes[key])) {
        fieldName = key;
        break;
      }
    }
  }

  const payload = {
    data: {
      [fieldName]: data
    }
  };

  const updateResponse = await fetch(`${config.url}${ENDPOINT}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!updateResponse.ok) {
    throw new Error(`Failed to update Strapi: ${updateResponse.statusText}`);
  }
}

