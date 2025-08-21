let websocket = null;
// The server URL can be configured here. The original fetch logic tried
// localhost:443 and then fell back to localhost:8443.
// The original websocket code hardcoded 8443, so we'll stick with that for now.
const WSS_URL = 'wss://localhost:8443/wss';

// A promise that resolves when the connection is established.
// This prevents multiple connection attempts from being made simultaneously.
let connectionPromise = null;

// Map to store handlers for in-flight requests.
const messageHandlers = new Map();
let messageId = 0;

/**
 * Handles incoming messages from the WebSocket server.
 * It expects messages to be in JSON format with an `id` to match them to a request.
 * @param {MessageEvent} event The WebSocket message event.
 * @private
 */
export function _handleWebSocketMessage(event) {
  console.log('WebSocket message received:', event.data);
  try {
    const message = JSON.parse(event.data);
    if (message.id && messageHandlers.has(message.id)) {
      const handler = messageHandlers.get(message.id);
      if (message.error) {
        handler.reject(new Error(message.error));
      } else {
        handler.resolve(message.payload);
      }
      messageHandlers.delete(message.id);
    } else {
      console.warn('Received WebSocket message with no matching handler or id:', message);
      // This is where you could handle broadcast messages from the server
      // that are not a direct response to a client request.
    }
  } catch (e) {
    console.error('Error parsing WebSocket message or no handler found:', e, event.data);
  }
}

/**
 * Establishes a WebSocket connection if one is not already open or opening.
 * Returns a promise that resolves when the connection is open.
 * @returns {Promise<void>}
 */
export function openWebSocket() {
  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = new Promise((resolve, reject) => {
    // If we already have a good connection, resolve immediately.
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }

    // If a connection is in progress, the promise will be handled by that attempt.
    if (websocket && websocket.readyState === WebSocket.CONNECTING) {
      console.log('WebSocket connection is already in progress.');
      return;
    }

    console.log('Attempting to connect to WebSocket:', WSS_URL);
    websocket = new WebSocket(WSS_URL);

    websocket.onopen = () => {
      console.log('WebSocket connection established.');
      resolve();
    };

    websocket.onmessage = _handleWebSocketMessage;

    websocket.onerror = (error) => {
      console.error('WebSocket Error:', error);
      websocket = null;
      connectionPromise = null; // Allow a new connection attempt later.
      reject(error);
    };

    websocket.onclose = () => {
      console.log('WebSocket connection closed. It will attempt to reconnect on the next request.');
      websocket = null;
      connectionPromise = null; // Allow a new connection attempt later.
    };
  });

  return connectionPromise;
}

/**
 * Sends a request to the WebSocket server and returns a promise that resolves with the response.
 * @param {string} type - The type of request (e.g., 'getToken').
 * @param {object} payload - The data to send with the request.
 * @returns {Promise<any>} A promise that resolves with the server's response payload.
 */
export function sendRequest(type, payload) {
  return new Promise(async (resolve, reject) => {
    try {
      // Ensure the WebSocket connection is established before sending.
      await openWebSocket();

      if (!websocket || websocket.readyState !== WebSocket.OPEN) {
        // This should theoretically not be reached if openWebSocket() succeeded, but as a safeguard:
        return reject(new Error('WebSocket is not connected.'));
      }

      const id = ++messageId;
      messageHandlers.set(id, { resolve, reject });

      const message = JSON.stringify({ id, type, payload });
      websocket.send(message);
      console.log('WebSocket request sent:', message);

      // Set a timeout for the server to respond.
      setTimeout(() => {
        if (messageHandlers.has(id)) {
          messageHandlers.delete(id);
          reject(new Error(`Request '${type}' (id: ${id}) timed out.`));
        }
      }, 30000); // 30-second timeout

    } catch (error) {
      // This will catch errors from openWebSocket() (e.g., connection failed).
      reject(error);
    }
  });
}

/**
 * Manually closes the WebSocket connection.
 */
export function closeWebSocket() {
  if (websocket) {
    console.log('Manually closing WebSocket connection.');
    websocket.close();
    websocket = null;
    connectionPromise = null;
  } else {
    console.log('WebSocket is not connected, no action taken.');
  }
}