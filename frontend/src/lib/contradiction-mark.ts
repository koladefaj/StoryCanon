import { Mark, mergeAttributes } from "@tiptap/core";

export interface ContradictionMarkOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    contradictionMark: {
      setContradiction: (id: string) => ReturnType;
      unsetContradiction: () => ReturnType;
    };
  }
}

export const ContradictionMark = Mark.create<ContradictionMarkOptions>({
  name: "contradiction",

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      contradictionId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-contradiction-id"),
        renderHTML: (attributes) => {
          if (!attributes.contradictionId) return {};
          return { "data-contradiction-id": attributes.contradictionId };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "mark.contradiction" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "mark",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: "contradiction",
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setContradiction:
        (id: string) =>
        ({ commands }) =>
          commands.setMark(this.name, { contradictionId: id }),
      unsetContradiction:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
