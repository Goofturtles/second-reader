/*
 * Sample rubrics and sample work.
 *
 * Everything here is preloaded so the first thing anyone sees is a finished
 * read, not an empty box. The rubrics are shaped the way real ones are: a
 * name, a descriptor written in the teacher's voice, and the concrete things
 * a marker actually hunts for in the text.
 */

/* --------------------------------- rubrics -------------------------------- */

const RUBRICS = [
  {
    id: "arg-essay-10",
    name: "Grade 10 argumentative essay",
    context: "Ontario ENG2D · persuasive unit · 500-word op-ed",
    criteria: [
      {
        id: "claim",
        name: "Claim",
        descriptor:
          "States one arguable position early and holds it. The reader should never be unsure what the writer is arguing for.",
        lookFor: ["thesis", "position", "argue", "claim", "stance", "should", "because"],
      },
      {
        id: "evidence",
        name: "Evidence and sourcing",
        descriptor:
          "Supports claims with specific evidence — data, studies, quotations, named examples — and makes the source visible rather than gesturing at 'studies show'.",
        lookFor: ["study", "data", "percent", "research", "according", "found", "source", "cite", "report"],
      },
      {
        id: "counter",
        name: "Counterargument",
        descriptor:
          "Represents the strongest opposing view fairly and answers it, instead of knocking down a weak version of it.",
        lookFor: ["however", "critics", "objection", "opponents", "although", "some argue", "on the other hand", "concede"],
      },
      {
        id: "clarity",
        name: "Clarity and control",
        descriptor:
          "Sentences are controlled and varied, transitions carry the reasoning, and the writing commits rather than hedging its way through.",
        lookFor: ["therefore", "so", "which means", "transition", "sentence", "precise", "concise"],
      },
    ],
  },
  {
    id: "lab-report-11",
    name: "Grade 11 chemistry lab report",
    context: "SCH3U · titration lab · formal write-up",
    criteria: [
      {
        id: "hypothesis",
        name: "Purpose and hypothesis",
        descriptor:
          "States what is being tested and predicts an outcome with a reason attached, not just a guess.",
        lookFor: ["hypothesis", "predict", "purpose", "expect", "because", "test"],
      },
      {
        id: "method",
        name: "Method and controls",
        descriptor:
          "Describes the procedure precisely enough to repeat, and names what was held constant and what was varied.",
        lookFor: ["procedure", "method", "control", "variable", "measured", "apparatus", "repeated", "trial"],
      },
      {
        id: "analysis",
        name: "Data and analysis",
        descriptor:
          "Reports real numbers with units, works through the calculation, and connects the result back to the chemistry rather than stopping at the answer.",
        lookFor: ["concentration", "moles", "mL", "calculate", "average", "titration", "endpoint", "units"],
      },
      {
        id: "error",
        name: "Sources of error",
        descriptor:
          "Names specific, plausible sources of error in this experiment and says which direction each one pushed the result. 'Human error' on its own earns nothing.",
        lookFor: ["error", "uncertainty", "parallax", "contamination", "overshoot", "systematic", "random", "precision"],
      },
    ],
  },
  {
    id: "prometheus",
    name: "Hackathon judging rubric (4 × 25)",
    context: "You may recognise this one. Same job: read against criteria, show the evidence.",
    criteria: [
      {
        id: "impact",
        name: "Educational impact",
        descriptor:
          "How effectively does the tool solve a real problem in education? Does it genuinely help someone learn, teach, or understand a concept better?",
        lookFor: ["teacher", "student", "learn", "classroom", "understand", "school", "feedback", "curriculum"],
      },
      {
        id: "ai",
        name: "Creative use of AI/ML",
        descriptor:
          "Is AI core to how the thing works, or bolted on at the end? Reward machine learning that the product could not function without.",
        lookFor: ["model", "AI", "machine learning", "embedding", "inference", "engine", "algorithm", "trained"],
      },
      {
        id: "exec",
        name: "Technical execution",
        descriptor:
          "Does it actually run? Judge functionality, stability, code quality and whether the interface is intuitive to a first-time user.",
        lookFor: ["works", "offline", "deployed", "stable", "interface", "latency", "handles", "fallback", "tested"],
      },
      {
        id: "pitch",
        name: "The pitch and demo",
        descriptor:
          "Is the two-minute video clear, concise and engaging? Does the writer explain who this is for and why it matters without padding?",
        lookFor: ["demo", "video", "explain", "shows", "walkthrough", "who", "why", "in seconds"],
      },
    ],
  },
];

/* ------------------------------- sample work ------------------------------ */

const WORKS = [
  {
    id: "phones-strong",
    rubricId: "arg-essay-10",
    label: "Essay A — Priya M.",
    title: "Phones should stay in the bag",
    meta: "ENG2D · 412 words · submitted 19 Aug",
    text: `Schools across Ontario banned phones in class in 2024, and the argument has not settled down since. I think the ban is right, but not for the reason most people give.

The usual case is grades. Supporters point to a 2016 London School of Economics study that found test scores rose by about 6.4% in schools that removed phones, with the largest gains among the lowest-achieving students. That is a real number and it matters. But grades are a narrow way to measure what a classroom is for.

The better reason is attention itself. A 2017 study in the Journal of the Association for Consumer Research found that having a phone face-down on the desk still reduced available working memory, even when it was never touched. The phone did not have to buzz. It just had to be there. Students in that study reported no difference in how distracted they felt, which is the interesting part: they could not feel the cost they were paying.

Critics say a ban treats students like children who cannot regulate themselves. Maybe that is sort of true. But we already accept this logic everywhere else. We do not let drivers text at the wheel and then call it a character failure when they do.

There is a fairness problem too. When phones are allowed, the students who lose the most are the ones who were already behind, and the LSE data shows exactly that pattern. A rule that helps struggling students more than it helps confident ones is probably a good rule.

The strongest objection is safety. Parents want to be able to reach their kids during the day. This is fair, and schools should keep a way to do that through the front office. But it is worth noticing that this argument is really about emergencies, and it gets used to defend all-day access.

So the ban should stay. Not because it raises scores, though it might, but because attention is the one resource a classroom actually runs on, and we were spending it without noticing.`,
  },
  {
    id: "phones-thin",
    rubricId: "arg-essay-10",
    label: "Essay B — Daniel O.",
    title: "Why phones are bad in school",
    meta: "ENG2D · 231 words · submitted 19 Aug",
    text: `Phones in school are a really big problem these days and I think something should probably be done about it. Everyone knows that phones are distracting and studies show that they make it harder to learn.

When students are on their phones they are not paying attention to the teacher. This is bad because the teacher is trying to teach and the student is not listening. A lot of students say they are just checking one thing but then twenty minutes go by. That happens to almost everyone I know.

Also phones can cause bullying. People post things about each other and it spreads around the whole school very fast. This can make people feel bad about themselves and sometimes they do not want to come to school anymore, which affects their grades too.

Some people might say that phones are useful for looking things up. That is kind of a good point but you can also just use a computer or ask the teacher, so it is not really necessary to have a phone.

In conclusion phones are bad for school and they should maybe be banned or at least limited in some way. If we did this then students would learn more and school would be a better place for everyone.`,
  },
  {
    id: "titration",
    rubricId: "lab-report-11",
    label: "Lab report — Amara T.",
    title: "Determining the concentration of acetic acid in vinegar",
    meta: "SCH3U · 318 words · submitted 21 Aug",
    text: `The purpose of this lab was to determine the concentration of acetic acid in commercial white vinegar by titrating it against a standardised sodium hydroxide solution. I predicted the concentration would come out near 0.83 mol/L, because the bottle is labelled 5% acetic acid by volume and that works out to roughly that value.

A 10.00 mL sample of vinegar was pipetted into a clean 250 mL Erlenmeyer flask and diluted with about 30 mL of distilled water. Two drops of phenolphthalein were added. The burette was rinsed with the 0.1005 mol/L NaOH solution and filled. Titration was repeated for three trials. The vinegar volume, the indicator, and the dilution water were kept the same across all three; only the volume of NaOH delivered was allowed to vary.

Titre volumes were 41.20 mL, 40.85 mL and 40.90 mL, giving an average of 40.98 mL. Moles of NaOH at the endpoint were 0.1005 mol/L × 0.04098 L = 4.118 × 10 to the -3 mol. Because acetic acid and hydroxide react in a 1:1 ratio, the flask contained the same number of moles of acetic acid, so the concentration was 4.118 × 10 to the -3 mol divided by 0.01000 L, which is 0.412 mol/L. This is about half the predicted value.

The first trial was noticeably higher than the other two, which suggests the endpoint was overshot on that run; the pink held for several seconds before I stopped adding. Overshooting biases the titre high and the concentration high, so the true value is likely nearer the second and third trials. Reading the burette from above rather than at eye level would introduce a parallax error, which pushes the recorded volume in whichever direction the eye is offset. There may also have been residual distilled water in the flask, but since it does not change the number of moles of acid present, it would not shift the result.`,
  },
  {
    id: "submission",
    rubricId: "prometheus",
    label: "Submission — a project write-up",
    title: "Project submission: a reading tool for teachers",
    meta: "Devpost description · 268 words",
    text: `Teachers do not run out of opinions about student work. They run out of hours. A secondary English teacher marking 140 essays against a four-criterion rubric spends most of that time re-reading to find the sentence that justifies the mark, and the feedback quality drops steadily from essay one to essay 140.

Second Reader is a marking companion, not a marking machine. Paste a rubric and a piece of student work and it returns, per criterion, the exact sentences in the work that evidence it, what is missing, and the single change that would move the work up a band. Every judgment is anchored to a quoted span you can click. It never outputs a grade, because the grade is the teacher's call and the evidence is what the teacher is short of.

Two engines read every submission. A local close reader runs entirely in the browser: sentence segmentation, tf-idf term weighting against the rubric descriptor, and eight linguistic signal detectors for hedging, specificity, sourcing and reasoning density. A cloud reader running Gemini reads the same work against the same rubric. Where the two disagree on a criterion, the app refuses to pick and flags it for a human instead.

The local engine means the tool still works with the Wi-Fi off, which is the state of most school networks at 3pm. There is no sign-up, no API key required to try it, and the sample rubric loads with a result already on screen.

The demo shows one essay read in about a second, the evidence highlighting live in the text, and the disagreement flag catching a criterion both readers scored differently.`,
  },
];


