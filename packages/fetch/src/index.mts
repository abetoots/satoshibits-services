interface FetchFactoryOptions {
  baseUrl?: string;
  errorHandlers: ErrorHandlers;
  retriableStatusCodes?: number[];
  maxRetries?: number;
}

interface ErrorHandlerMeta {
  fetchUrl: string;
  attempt: number;
  fetchOptions: RequestInit;
  context: Record<string, unknown>;
}

interface ErrorHandlers {
  /** Handler for network or other fetch errors. */
  onFetchError?: (error: Error, meta: ErrorHandlerMeta) => Promise<void> | void;
  /** Handler for HTTP status errors. */
  onStatusError?: (
    response: Response,
    meta: ErrorHandlerMeta,
  ) => Promise<void> | void;
  /** Handler for JSON parsing errors. */
  onSyntaxError?: (
    error: Error,
    meta: ErrorHandlerMeta,
  ) => Promise<void> | void;
  /** Handler for fetch abort errors. */
  onAbortError?: (
    error: DOMException,
    meta: ErrorHandlerMeta,
  ) => Promise<void> | void;
}

/**
 * Creates a fetch function with error handling capabilities.
 * The function will retry requests that fail with the specified retriable status codes
 * or network errors up to a specified number of times.
 *
 * @param baseUrl - The base URL to be used for all fetch requests.
 * @param errorHandlers - An optional object containing error handler functions.
 * @returns A function that performs fetch requests with the specified error handlers.
 *
 *
 * @example
 * const fetchWithHandlers = fetchFactory('https://api.example.com', {
 *   onStatusError: (status, statusText, response) => {
 *     console.error(`HTTP Error: ${status} ${statusText}`);
 *   },
 *   onSyntaxError: (error) => {
 *     console.error('JSON Parsing Error:', error);
 *   },
 *   onAbortError: (error) => {
 *     console.warn('Fetch aborted:', error);
 *   },
 *   onFetchError: (error) => {
 *     console.error('Fetch Error:', error);
 *   },
 * });
 *
 * fetchWithHandlers('/endpoint', { method: 'GET' })
 *   .then(data => console.log(data))
 *   .catch(error => console.error(error)); //unhandled errors
 */
export const fetchFactory = (options: FetchFactoryOptions) => {
  const maxRetries = options.maxRetries ?? 3;
  const retriableStatusCodes = options.retriableStatusCodes ?? [
    500, 502, 503, 504,
  ];

  const fetchWithHandlers = async (
    url: string,
    fetchOptions: RequestInit = {},
    /**
     * Additional context to be passed on to the the error handlers. Useful
     * for passing additional information when calling this function.
     */
    context: Record<string, unknown> = {},
    attempt = 0,
  ) => {
    const { onFetchError, onStatusError, onSyntaxError, onAbortError } =
      options.errorHandlers;

    const fetchUrl = options.baseUrl ? `${options.baseUrl}${url}` : url;

    try {
      const response = await fetch(fetchUrl, fetchOptions);

      // Check if status is not in the 2xx range
      if (!response.ok) {
        if (
          retriableStatusCodes.includes(response.status) &&
          attempt < maxRetries
        ) {
          // Retry the request
          return fetchWithHandlers(url, fetchOptions, context, attempt + 1);
        }

        void onStatusError?.(response, {
          fetchUrl,
          attempt,
          fetchOptions,
          context,
        });

        return {
          type: "status" as const,
          status: response.status,
          response,
        };
      }

      // Try parsing the response as JSON
      try {
        const data = await response.json(); // Assumes JSON response

        return {
          type: "success" as const,
          data,
        };
      } catch (syntaxError) {
        void onSyntaxError?.(syntaxError as Error, {
          fetchUrl,
          attempt,
          fetchOptions,
          context,
        });
        return {
          type: "syntax" as const,
          error: syntaxError,
        };
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        // Handle fetch abort error
        void onAbortError?.(error, {
          fetchUrl,
          attempt,
          fetchOptions,
          context,
        });

        return {
          type: "abort" as const,
          error,
        };
      } else {
        if (attempt < maxRetries) {
          return fetchWithHandlers(url, fetchOptions, context, attempt + 1);
        }
        // Handle network or other fetch errors
        void onFetchError?.(error as Error, {
          fetchUrl,
          attempt,
          fetchOptions,
          context,
        });
        return {
          type: "fetch" as const,
          error,
        };
      }
    }
  };

  return fetchWithHandlers;
};
