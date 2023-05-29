import { produceWithPatches, applyPatches, Draft, Patch } from 'immer';

// Define a base message interface for all messages sent to actors.
interface BaseMessage {
	type: string;
	version?: number;
}

// Define a change interface for Immer's patches.
interface Change {
	op: 'replace' | 'remove' | 'add';
	path: (string | number)[];
	value?: any;
}

interface History<T> {
	past: T[];
	future: T[];
}

// Actor class representing the base class for all actors.
export abstract class Actor<
	State extends Readonly<{}>,
	Message extends Readonly<BaseMessage>
> {
	private readonly id: string;
	private readonly parent?: Actor<State, Message>;
	private children: Actor<State, Message>[] = [];
	private state: State;
	private subscribers: ((state: State) => void)[] = [];
	private history: History<{ state: State; inversePatches: Patch[] }> = {
		past: [],
		future: [],
	};

	constructor(id: string, initialState: State, parent?: Actor<State, Message>) {
		this.id = id;
		this.parent = parent;
		this.state = initialState;
		this.onStart();
	}

	// onStart is called when the actor is created.
	protected onStart(): void {}

	// onStop is called when the actor is stopped.
	protected onStop(): void {}

	// onRestart is called when the actor is restarted.
	protected onRestart(): void {}

	// Subscribes a callback function to be called when the state changes.
	subscribe(callback: (state: State) => void): () => void {
		this.subscribers.push(callback);
		return () => {
			this.subscribers = this.subscribers.filter(
				(subscriber) => subscriber !== callback
			);
		};
	}

	// Sends a message to the actor, which is processed and may cause a state change.
	sendMessage(message: Message): void {
		// Enforce forward compatibility by handling unknown message types gracefully.
		if (!this.isMessageTypeValid(message.type)) {
			console.warn(`Unknown message type: ${message.type}`);
			return;
		}

		this.processMessage(message);
	}

	// Returns true if the message type is valid, false otherwise.
	protected abstract isMessageTypeValid(type: string): boolean;

	/**
	 * Processes an incoming message, updates the state, and manages the undo/redo history.
	 * @param message - The message to process.
	 */
	private processMessage(message: Message) {
		// Use the Immer library's "produceWithPatches" function to create a new state
		// by applying the changes described in the "handleMessage" method, and obtain
		// the patches and inverse patches directly.
		const [newState, patches, inversePatches] = produceWithPatches(
			this.state,
			(draft: Draft<State>): void => {
				// Call the "handleMessage" method with the draft state and the input message.
				// "handleMessage" is an abstract method that needs to be implemented in each
				// concrete actor class. It defines how each specific message type should
				// affect the state.
				this.handleMessage(draft, message);
			}
		);

		// Update the state with the new state produced by "produceWithPatches".
		this.state = newState;

		// Use the patches and inverse patches to manage the undo/redo history.
		// The current state and inverse patches are pushed onto the "past" array in
		// the "history" object. The "future" array in the "history" object is
		// cleared since new changes have been made, making any previously undone
		// changes non-applicable.
		this.history.past.push({ state: this.state, inversePatches });

		// Clear future when new changes are made
		this.history.future = [];

		this.notifySubscribers();
	}

	// Handles the received message, modifying the draft state according
	// to the message type.
	protected abstract handleMessage(draft: Draft<State>, message: Message): void;

	// Notifies subscribers about state changes.
	private notifySubscribers(): void {
		this.subscribers.forEach((callback) => callback(this.state));
	}

	// Undoes the last state change, moving the inverse changes from the history to the future.
	undo(): void {
		if (this.history.past.length === 0) {
			return;
		}

		const { state, inversePatches } = this.history.past.pop()!;
		const [newState, newPatches] = applyPatches(this.state, inversePatches);

		this.history.future.push({ state: this.state, inversePatches: newPatches });
		this.state = newState;
		this.notifySubscribers();
	}

	// Redoes the last undone state change, moving the inverse changes from the future to the history.
	redo(): void {
		if (this.history.future.length === 0) {
			return;
		}

		const { state, inversePatches } = this.history.future.pop()!;
		const [newState, newPatches] = applyPatches(this.state, inversePatches);

		this.history.past.push({ state: this.state, inversePatches: newPatches });
		this.state = newState;
		this.notifySubscribers();
	}

	// Creates a child actor with the given ID and initial state.
	createChild(id: string, initialState: State): Actor<State, Message> {
		const child = new (this.constructor as any)(id, initialState, this);
		this.children.push(child);
		return child;
	}

	// Returns the actor's unique ID.
	getId(): string {
		return this.id;
	}

	// Returns the actor's parent, if it has one.
	getParent(): Actor<State, Message> | undefined {
		return this.parent;
	}
}
