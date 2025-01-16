import hljs from "highlight.js";
import assert from "node:assert";
import fs from "node:fs";

if (fs.existsSync("dist")) fs.rmdirSync("dist", { recursive: true });
fs.cpSync("./public", "./dist", { recursive: true });

let articles = fs
    .readdirSync("articles")
    .map((file) => {
        const raw = fs.readFileSync(`articles/${file}`, "utf-8");
        const [, rawMetadata, ...contentParts] = raw.split("---");
        const content = contentParts.join("---").trim();
        const metadata = Object.fromEntries(
            rawMetadata
                .trim()
                .split("\n")
                .map((line) => line.split(": "))
        );
        metadata.slug = file.replace(".md", "");
        metadata.tags = metadata.tags.split(",").map((t) => t.trim());
        metadata.commentsId = metadata.comments_id;
        delete metadata.comments_id;
        return {
            metadata,
            content,
        };
    })
    .filter((a) => a.metadata.draft !== "true")
    .sort((a, b) => new Date(b.metadata.date).getTime() - new Date(a.metadata.date).getTime());

const listItemTemplate = fs.readFileSync("src/item.html", "utf-8");
const articleTemplate = fs.readFileSync("src/page.html", "utf-8");
let index = fs.readFileSync("src/index.html", "utf-8");

let listHtml = "";
let year = Infinity;
for (const article of articles) {
    const currentYear = parseInt(article.metadata.date.split("-")[0]);
    if (currentYear < year) {
        listHtml += /*html*/ `<h3 class="${
            year === Infinity ? "first-year" : "year"
        }">${currentYear}</h3>`;
        year = currentYear;
    }
    listHtml += listItemTemplate.replace(/\{\{([^}]+)\}\}/g, (_, property) => {
        if (property === "tags") {
            return (
                '<p class="tags">' +
                article.metadata.tags.map((tag) => /*html*/ `<code>${tag}</code>`).join(", ") +
                "</p>"
            );
        }
        if (property === "updated") {
            if (article.metadata.updated) {
                return /*html*/ `<p class="updated">| Updated on ${article.metadata.updated}</p>`;
            } else {
                return "";
            }
        }
        if (article.metadata[property]) return article.metadata[property];
        return property;
    });

    fs.mkdirSync(`dist/${article.metadata.slug}`);
    const page = articleTemplate.replace(/\{\{([^}]+)\}\}/g, (_, property) => {
        if (property === "rawTags") return article.metadata.tags.join(",");
        if (property === "tags") {
            return (
                '<p class="tags">Tags: ' +
                article.metadata.tags.map((tag) => /*html*/ `<code>${tag}</code>`).join(", ") +
                "</p>"
            );
        }
        if (property === "updated") {
            if (article.metadata.updated) {
                return /*html*/ `<span>| Updated on ${article.metadata.updated}</span>`;
            } else {
                return "";
            }
        }
        if (property === "comments")
            return /*html*/ `<iframe class="comments" src="https://hihan.tti.sh/comments/${article.metadata.commentsId}"></iframe>`;
        if (property === "content") return mdToHtml(article.content);
        if (article.metadata[property]) return article.metadata[property];
        return property;
    });
    fs.writeFileSync(`dist/${article.metadata.slug}/index.html`, page);
}

index = index.replace("{{list}}", listHtml);
fs.writeFileSync("dist/index.html", index);

/**
 * @param {string} content
 * @returns string
 */
function mdToHtml(content) {
    const lines = content.split("\n");
    let html = "";
    let inString = false;
    let inQuote = false;
    let inUl = false;
    let inOl = false;
    let inCode = false;
    let codeBuffer = "";
    let codeLang = "";
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith("#")) {
            const match = line.match(/^#+ /);
            assert(match);
            const level = Math.min(match[0].length, 6);
            const text = line.replace(/^#+/, "").trim();
            html += `<h${level}>${text}</h${level}>\n`;
        } else if (line.startsWith("-")) {
            const text = line.replace(/^-/, "").trim();
            if (!inUl) {
                html += "<ul>\n";
                inUl = true;
            }
            html += `<li>${text}</li>\n`;
        } else if (line.match(/^\d+\. /)) {
            const text = line.replace(/^\d+\./, "").trim();
            if (!inOl) {
                html += "<ol>\n";
                inOl = true;
            }
            html += `<li>${text}</li>\n`;
        } else if (line.match(/^!\[[^\]]*?\]\([^\)]*?\)$/)) {
            const match = line.match(/^!\[([^\]]*?)\]\(([^\)]*?)\)$/);
            assert(match);
            let alt = match[1];
            let src = match[2];
            if (src.startsWith("../public/assets/")) {
                src = src.replace("../public/assets/", "../assets/");
            }
            let extra = "";
            if (alt.includes("|")) {
                const parts = alt.split("|");
                assert(parts.length == 2, "Invalid size string");
                alt = parts[0].trim();
                const sizeStr = parts[1].trim();
                if (/^\d+x\d+$/.test(sizeStr)) {
                    const [width, height] = sizeStr.split("x").map((n) => parseInt(n, 10));
                    extra = `style="width: ${width}px; height: ${height}px;"`;
                } else if (/^\d+$/.test(sizeStr)) {
                    extra = `style="width: ${parseInt(sizeStr, 10)}px;"`;
                } else {
                    assert(false, "Invalid size string");
                }
            }
            html += `<img src="${src}" alt="${alt}" ${extra}>\n`;
        } else if (line.startsWith("```")) {
            if (inCode) {
                const code = codeBuffer.trim();
                const codeContent = codeLang
                    ? hljs.highlight(code, { language: codeLang }).value
                    : code;
                html += codeContent;
                html += "</code>\n";
                codeBuffer = "";
                codeLang = "";
                inCode = false;
            } else {
                const lang = line.replace(/```/, "").trim();
                html += `<code class="code-block" data-lang="${lang}">`;
                codeLang = lang;
                inCode = true;
            }
        } else if (line.startsWith("> ")) {
            if (!inQuote) {
                html += "<blockquote>\n";
                inQuote = true;
            }
            html += inlineStyle(line.replace(/^> /, "")) + (line.endsWith("  ") ? "<br>\n" : "\n");
        } else if (line === "") {
            if (inUl) {
                html += "</ul>\n";
                inUl = false;
            }
            if (inOl) {
                html += "</ol>\n";
                inOl = false;
            }
            if (inString) {
                html += lines[i - 1].endsWith(">") ? "\n" : "\n</p>\n";
                inString = false;
            }
            if (inQuote) {
                html += "</blockquote>\n";
                inQuote = false;
            }
            html += '<div class="linebreak"></div>\n';
        } else {
            if (inCode) {
                codeBuffer += line + "\n";
            } else {
                if (!inString) {
                    html += line.startsWith("<") ? "" : "<p>\n";
                    inString = true;
                }
                html += inlineStyle(line) + (line.endsWith("  ") ? "<br>\n" : "\n");
            }
        }
    }
    return html;
}

/**
 * @param {string} line
 * @returns string
 */
function inlineStyle(line) {
    let html = "";
    let inItalic = false;
    let italicType = "";
    let inBold = false;
    let inInlineCode = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === "*" && line[i + 1] === "*") {
            if (inBold) {
                html += "</strong>";
                inBold = false;
            } else {
                html += "<strong>";
                inBold = true;
            }
            i += 1;
        } else if (inItalic ? char === italicType : char === "*" || char === "_") {
            if (inItalic) {
                html += "</i>";
                inItalic = false;
                italicType = "";
            } else {
                html += "<i>";
                inItalic = true;
                italicType = char;
            }
        } else if (char === "`") {
            if (inInlineCode) {
                html += "</span>";
                inInlineCode = false;
            } else {
                html += '<span class="inline-code">';
                inInlineCode = true;
            }
        } else if (char === "[") {
            const match = line.substring(i).match(/^\[([^\]]*?)\]\(([^\)]*?)\)/);
            assert(match);
            html += `<a href="${match[2]}">${match[1]}</a>`;
            i += match[0].length - 1;
        } else {
            html += char;
        }
    }
    return html;
}
