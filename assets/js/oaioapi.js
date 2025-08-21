// worker.js
let machineConfig = null;
let messages = null;
let llmSettings = null;


self.onmessage = async function (event) {
	// Parameters for the LLM API call from the main thread
	machineConfig = event.data.config;
	console.log('Worker received machine config:', machineConfig);
	llmSettings = event.data.settings;
	messages = event.data.messages;
	console.log('Worker received messages:', messages);


	try {
		// --- 2. Fetch instruction ---
		let instructionText; // Declare here to ensure it's in scope
		try {
			console.log(`Worker: Fetching the Machine instruction from ${machineConfig.server}`);
			const instructionResponse = await fetch(machineConfig.server + '/' + machineConfig.instructions_file, {mode: "cors"});
			if (!instructionResponse.ok) {
				console.log(`Worker: HTTP error fetching instruction! status: ${instructionResponse.status}. Using default instruction.`);
				// Default instruction if fetching fails or file not found
				instructionText = "You are a helpful assistant.";
			} else {
				instructionText = (await instructionResponse.text()).trim();
				console.log('Worker: Instruction fetched successfully.');
				console.log('Worker: Instruction:', instructionText);
			}
		} catch (fetchError) {
			console.error('Worker: Error during instruction file fetch:', fetchError.message, '. Using default instruction.');
			instructionText = "You are a helpful assistant."; // Default instruction on any fetch error
		}

		// --- 3. Prepare messages for the API call ---
		const systemInstructionMessage = {role: "system", content: instructionText};
		let messagesForApi;

		// Check if the main thread sent any messages
		if (messages && Array.isArray(messages) && messages.length > 0) {
			// User provided messages: unshift/prepend the fetched system instruction
			messagesForApi = [systemInstructionMessage, ...messages];
			console.log('All messages for API:', messagesForApi)
		} else {
			// No messages from user, or an empty array: use the system instruction and a default user prompt
			messagesForApi = [
				systemInstructionMessage,
				{role: "user", content: "What model are you?"} // Default user prompt
			];
		}

		// --- 4. Prepare the final API payload ---
		const defaultApiParameters = {
			model: llmSettings.model || machineConfig.llm,
			max_output_tokens: llmSettings.max_output_tokens || 8192,
			temperature: llmSettings.temperature || 1.0,
			reasoning: {
				"effort": llmSettings.reasoning_effort || "high",
				"summary": llmSettings.reasoning_summary || "detailed"
			}
		};
		console.log('Worker: Default API parameters:', defaultApiParameters)
		// Merge default parameters, then incoming user parameters (which might override temp, max_tokens, etc.),
		const finalApiPayload = {
			...defaultApiParameters,
			input: messagesForApi      // Ensure our carefully constructed messages array is used
		};
		console.log('Worker: Here is the final API payload:', finalApiPayload);


		// --- 5. Make the LLM API call ---
		const apiOptions = {
			method: 'POST',
			headers: {
				'Authorization': 'Bearer ' + llmSettings.token,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(finalApiPayload)
		};

		console.log('Worker: Making API call to OpenAI API with payload:', finalApiPayload);
		const apiCallResponse = await fetch(machineConfig.apiUrl, apiOptions);

		if (!apiCallResponse.ok) {
			let errorDetails = await apiCallResponse.text();
			try {
				// Try to parse if the error response is JSON for more structured info
				errorDetails = JSON.parse(errorDetails);
			} catch (e) {
				// It's not JSON, use the raw text
			}
			console.error('Worker: API Error Response:', errorDetails);
			throw new Error(`API Error: ${apiCallResponse.status} - ${typeof errorDetails === 'string' ? errorDetails : JSON.stringify(errorDetails)}`);
		}

		const apiData = await apiCallResponse.json();
		console.log('Worker: API call successful, response:', apiData);
		const choice = apiData.output
		console.log('Worker: API output:', choice);

		// Send the successful result back to the main thread
		self.postMessage({type: 'success', data: choice});

	} catch (error) {
		console.error('Worker: An error occurred:', error.message, error); // Log the full error object for more details
		// Send the error back to the main thread
		self.postMessage({type: 'error', error: error.message});
	}
};

console.log('Worker: Script loaded and ready for messages.');
