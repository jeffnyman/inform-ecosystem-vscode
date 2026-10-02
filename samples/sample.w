[Sampler::] Sample Section.

A section of an Inweb web, exercising the Inweb grammar. The prose here is
commentary, and may mention |inline code| or `inline code` and refer to
@<Do the sampling@> by name.

@h Definitions.
Constants are introduced with definitions and enumerations:

@d MAX_SAMPLES 100
@e FIRST_SAMPLE_CLSW
@e SECOND_SAMPLE_CLSW from 10

@ The main routine is plain code after an equals sign:

=
int Sampler::run(int argc, char **argv) {
	printf("[[Title]] version [[Version Number]]\n");
	@<Do the sampling@>;
	return 0;
}

@<Do the sampling@> =
	for (int i = 0; i < MAX_SAMPLES; i++)
		Sampler::take(i); /* a C comment */

@h Another heading.
And the web continues.
