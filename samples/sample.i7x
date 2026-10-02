Version 1 of Quendor Sampling by Jeff Nyman begins here.

"A sampler extension used to exercise the Inform 7 extension grammar."

"based on nothing in particular"

Chapter 1 - Phrases

To sample (N - a number):
	say "Sampled [N]."

Section 2 - Low-level

To clear the sample: (- QuendorClear(); -).

Include (-
[ QuendorClear; rtrue; ];
-).

Quendor Sampling ends here.

---- DOCUMENTATION ----

This extension does very little, on purpose.

Chapter: Using it

Section: Sampling

Call "sample 3" from any rule:

	When play begins:
		sample 3.

Example: * Sampler - A one-room demonstration.

	*: "Sampler"

	Include Quendor Sampling by Jeff Nyman.

	The Lab is a room.
