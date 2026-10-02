"Inform 7 Sampler" by Jeff Nyman

[This file exercises the Inform 7 grammar. It is not a real story. Comments nest: [like this [and this]] safely.]

Include Basic Screen Effects by Emily Short.
Include version 3/120430 of Glulx Entry Points by Emily Short.

Volume 1 - The World

Book 1 - Places

Part 1 - Underground

Chapter 1 - The Vault

Section 1 - Setting the scene

The Vault is a room. "A low stone chamber. [if the lamp is lit]Shadows jump along the walls.[otherwise]It is pitch dark.[end if]"

The brass lamp is a device in the Vault. The description is "An old lamp, [if the lamp is switched on]glowing[otherwise]cold[end if]."

Instead of taking the lamp when the lamp is switched on, say "Too hot to hold."

Table of Treasures
item	value
"a ruby"	50
"a sapphire"	75

Section 2 - Low-level code

To flash the screen: (- FlashScreen(); -).

Include (-
[ FlashScreen;
  ! A tiny Inform 6 routine spliced into the story.
  print "^"; (+ the brass lamp +).number = 3;
];
-) after "Definitions.i6t".

Section 3 - Vorple

When play begins:
	execute JavaScript command "console.log('Hello from [the lamp]')";
	let the snippet be [js]"document.title = 'Quendor'";

Section 4 - Preform

[preform](-
<lamp-state> ::=
	lit |
	unlit
-)

Test me with "look / switch lamp on / take lamp".
