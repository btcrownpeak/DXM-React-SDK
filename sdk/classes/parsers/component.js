const babelParser = require("@babel/parser");

let _componentName = "";

const reComponentType1 = /^\s*this.([a-z0-9_]+)\s*$/i;
const reComponentType2 = /^\s*this\s*\[\s*(["'])([a-z0-9_]+)\s*\1\s*\]\s*$/i;
const reComponentType3 = /^\s*new\s+CmsField\s*[(]\s*(["'])([a-z0-9_]+)\1\s*,\s*CmsFieldTypes.([a-z0-9]+)(\s*,.*,\s*CmsIndexedField\.([a-z]+))?/i;
const reComponentType4 = /^\s*new\s+CmsField\s*[(]\s*(["'])([a-z0-9_]+)\1\s*,\s*(["'])([a-z0-9_]+)\3(\s*,.*,\s*CmsIndexedField\.([a-z]+))?/i;
const reList = /^([ \t]*){\s*\/\*\s*<List(.*?)\s*type=(["'])([^"']+?)\3(.*?)>\s*\*\/\s*}((.|\s)*?){\s*\/\*\s*\<\/List>\s*\*\/\s*}/im;
const reListName = /\s+?name\s*=\s*(["'])([^"']+?)\1/i;
const reListItemName = /\s+?itemName\s*=\s*(["'])([^"']+?)\1/i;

const parse = (content) => {
    let ast = babelParser.parse(content, {
        sourceType: "module",
        plugins: ["jsx", "classProperties"]
    });
    //console.log(JSON.stringify(ast));
    if (ast.errors && ast.errors.length > 0) {
        console.warn(`COMPONENT: Skipping due to errors`);
        return;
    }

    let results = [];
    let imports = [];
    let dependencies = [];
    let bodyParts = ast.program.body;
    for (let i = 0, len = bodyParts.length; i < len; i++) {
        const part = bodyParts[i];
        if (part.type === "ImportDeclaration" && part.specifiers && part.specifiers.length > 0) {
            for (let i in part.specifiers) {
                const specifier = part.specifiers[i];
                if ((specifier.type === "ImportDefaultSpecifier" || specifier.type === "ImportSpecifier")
                    && specifier.local && specifier.local.type === "Identifier") {
                    //console.log(`Found import ${specifier.local.name}`);
                    imports.push(specifier.local.name);
                }
            }
        }
    }
    // Parse out any special lists
    content = replaceLists(content);

    // Re-parse the content after our changes
    ast = babelParser.parse(content, {
        sourceType: "module",
        plugins: ["jsx", "classProperties"]
    });
    bodyParts = ast.program.body;
    for (let i = 0, len = bodyParts.length; i < len; i++) {
        const part = bodyParts[i];
        if (part.type === "ExportDefaultDeclaration" || part.type === "ExportNamedDeclaration") {
            if (part.declaration.type === "ClassDeclaration"
                && part.declaration.superClass
                && part.declaration.superClass.name === "CmsComponent") {
                //console.log(`Found class ${part.declaration.id.name} extending CmsComponent`);
                const name = part.declaration.id.name;
                const result = processCmsComponent(content, ast, part.declaration, imports, dependencies);
                if (result) {
                    results.push({name: name, content: finalProcessMarkup(result), dependencies: dependencies});
                }
            }
        }
    }
    return results;
};

const finalProcessMarkup = (content) => {
    // Parse out any cp-scaffolds
    content = replaceScaffolds(content);
    // Remove anything that has { and } but doesn't look like a component
    const replacer = /[{]([^}]*?[\s,/$()][^}]*?)[}]/g;
    while (replacer.test(content)) {
        content = content.replace(replacer, "$1");
    }
    content = content.replace(/className/ig, "class");
    return trimSharedLeadingWhitespace(content);
};

const replaceScaffolds = (content) => {
    const scaffoldRegexs = [
        { source: "\\{\\s*\\/\\*\\s*cp-scaffold\\s*((?:.|\\r|\\n)*?)\\s*else\\s*\\*\\/\\}\\s*((?:.|\\r|\\n)*?)\\s*\\{\\s*\\/\\*\\s*\\/cp-scaffold\\s*\\*\\/\\}", replacement: "$1"},
        { source: "\\{\\s*\\/\\*\\s*cp-scaffold\\s*((?:.|\\r|\\n)*?)\\s*\\/cp-scaffold\\s*\\*\\/\\}", replacement: "$1"}
    ];
    let result = content;
    for (let j = 0, lenJ = scaffoldRegexs.length; j < lenJ; j++) {
        let regex = new RegExp(scaffoldRegexs[j].source);
        let match = regex.exec(result);
        while (match) {
            let replacement = scaffoldRegexs[j].replacement;
            //console.log(`Replacing [${match[0]}] with [${replacement}]`);
            result = result.replace(regex, replacement);
            match = regex.exec(result);
        }
    }
    return result;
};

const replaceLists = (content) => {
    let match;
    while (match = reList.exec(content)) {
        let attributes = " " + match[2] + " " + match[5];
        let name = "";
        let itemName = "";
        const ws = match[1];
        const type = match[4];
        if (reListName.test(attributes)) {
            const nameMatch = reListName.exec(attributes);
            name = nameMatch[2];
        }
        if (reListItemName.test(attributes)) {
            const nameMatch = reListItemName.exec(attributes);
            itemName = nameMatch[2];
        }
        if (!name) {
            name = type + "s"; // TODO: better way to make plural
        }
        if (!itemName) {
            itemName = type;
        }
        //console.log(`Found list with name ${name}`);
        const repl = `${ws}<cp-list name="${name}">\r\n${ws}  {new CmsField("${itemName}", "${type}")}\r\n${ws}</cp-list>`;
        content = content.replace(match[0], repl);
    }
    return content;
};

const trimSharedLeadingWhitespace = (content) => {
    // Trim leading whitespace common to all lines except blanks
    const onlyWhitespace = /^\s*$/;
    const leadingWhitespace = /^\s*/;
    let lines = content.split(`\n`);
    let maxLeader = 99;
    for (let i in lines) {
        let line = lines[i];
        if (i == 0 || onlyWhitespace.test(line)) continue;
        let match = line.match(leadingWhitespace);
        if (match && match[0].length) maxLeader = Math.min(maxLeader, match[0].length);
    }
    if (maxLeader > 0) {
        const leadingWhitespaceReplacer = new RegExp(`^\\s{${maxLeader}}`);
        for (let i in lines) {
            let line = lines[i];
            if (i == 0 || onlyWhitespace.test(line)) continue;
            lines[i] = line.replace(leadingWhitespaceReplacer, "");
        }
        content = lines.join('\n');
    }
    return content;
};

const processCmsComponent = (content, ast, declaration, imports, dependencies) => {
    _componentName = declaration.id.name;
    //console.log(`Processing CmsComponent ${declaration.id.name}`);
    const bodyParts = declaration.body.body;
    for (let i = 0, len = bodyParts.length; i < len; i++) {
        const part = bodyParts[i];
        if (part.type === "ClassMethod" && part.key.name === "render") {
            return processCmsComponentReturn(content, declaration, part, imports, dependencies);
        }
    }
};

const processCmsComponentReturn = (content, component, render, imports, dependencies) => {
    const parts = render.body.body;
    for (let i = 0, len = parts.length; i < len; i++) {
        const part = parts[i];
        if (part.type === "ReturnStatement"
            && part.argument.type === "JSXElement") {
            //console.log(`Found JSX pattern ${content.slice(part.argument.start, part.argument.end)}`);
            let replacements = [];
            processCmsComponentPattern(content, component, part, replacements, imports, dependencies);

            // Replace the items in the pattern
            // Go from last to first, so we don't change the index numbers
            let pattern = content.slice(part.argument.start, part.argument.end);
            const offset = part.argument.start;
            if (replacements.length > 0) {
                for (let j = replacements.length - 1; j >= 0; j--) {
                    var rep = replacements[j];
                    pattern = pattern.slice(0, rep.start - offset) + rep.value + pattern.substr(rep.end - offset);
                }
            }
            //console.log(`New JSX pattern ${pattern}`);
            return pattern;
        }
    }
};

const processCmsComponentPattern = (content, component, object, replacements, imports, dependencies) => {
    if (!object) return;
    if (object.type === "JSXExpressionContainer") {
        processJsxExpression(content, component, object, replacements, imports);
    } else if (object.type === "JSXElement" && object.openingElement && object.openingElement.name
        && imports.find(i => object.openingElement.name.name === i)) {
        processJsxElement(content, component, object, replacements, imports, dependencies);
    } else if (typeof object !== "string" && Array.isArray(object)) {
        for (let i = 0, len = object.length; i < len; i++) {
            processCmsComponentPattern(content, component, object[i], replacements, imports, dependencies);
        }
    } else if (typeof object !== "string") {
        const keys = Object.keys(object);
        for (let key in keys) {
            processCmsComponentPattern(content, component, object[keys[key]], replacements, imports, dependencies);
        }
    }
};

const processJsxExpression = (content, component, object, replacements, imports) => {
    let result = processJsxExpressionSub(content, component, object, imports);
    if (result) {
        if (result.thisproperty) {
            // Find the definition of this field
            result = findCmsFieldFromVariable(content, component, result.thisproperty, result.comment);
        }
        if (result.cmsfield) {
            let indexedField = cmsIndexedFieldToString(result.indexedField);
            if (indexedField) indexedField = ":" + indexedField;
            //console.log(`Replacing ${content.slice(object.start, object.end)} with {${result.cmsfield}:${cmsFieldTypeToString(result.type)}${indexedField}}`);
            replacements.push({start: object.start, end: object.end, value: `${result.comment ? "<!-- " : ""}{${result.cmsfield}:${cmsFieldTypeToString(result.type)}${indexedField}}${result.comment ? " -->" : ""}`});
        } else {
            // Trim first and last character to remove { and }
            replacements.push({start: object.start, end: object.end, value: content.slice(object.start + 1, object.end - 1)});
        }
    }
};

const processJsxExpressionSub = (content, component, object, imports) => {
    if (object.type === "MemberExpression"
        && object.object && object.object.type === "ThisExpression"
        && object.property && object.property.type === "Identifier") {
        // Items of the form
        // { this.field_name }
        //console.log(`Found this.${object.property.name}`);
        return { thisproperty: object.property.name };
    }
    else if (object.type === "MemberExpression"
        && object.object && object.object.type === "ThisExpression"
        && object.property && object.property.type === "StringLiteral") {
        // Items of the form
        // { this["field_name"] }
        //console.log(`Found this.${object.property.value}`);
        return { thisproperty: object.property.value };
    }
    else if (object.type === "NewExpression"
        && object.callee && object.callee.type == "Identifier" && object.callee.name === "CmsField"
        && object.arguments && object.arguments.length > 1
        && object.arguments[0].type === "StringLiteral"
        && object.arguments[1].type === "MemberExpression"
        && object.arguments[1].object && object.arguments[1].object.type === "Identifier" && object.arguments[1].object.name === "CmsFieldTypes"
        && object.arguments[1].property) {
        if (object.arguments.length > 3 && object.arguments[3].object && object.arguments[3].object.type === "Identifier" && object.arguments[3].object.name === "CmsIndexedField") {
            // Items of the form
            // { new CmsField("field_name", CmsFieldTypes.FieldType, something, CmsIndexedField.TYPE) }
            //console.log(`Found field ${object.arguments[0].value} type ${object.arguments[1].property.name} indexedField ${object.arguments[3].property.name}`);
            return { cmsfield: object.arguments[0].value, type: object.arguments[1].property.name, indexedField: object.arguments[3].property.name };
        } else {
            // Items of the form
            // { new CmsField("field_name", CmsFieldTypes.FieldType) }
            //console.log(`Found field ${object.arguments[0].value} type ${object.arguments[1].property.name}`);
            return { cmsfield: object.arguments[0].value, type: object.arguments[1].property.name };
        }
    }
    else if (object.type === "NewExpression"
        && object.callee && object.callee.type == "Identifier" && object.callee.name === "CmsField"
        && object.arguments && object.arguments.length > 1
        && object.arguments[0].type === "StringLiteral"
        && object.arguments[1].type === "StringLiteral") {
        if (object.arguments.length > 3 && object.arguments[3].object && object.arguments[3].object.type === "Identifier" && object.arguments[3].object.name === "CmsIndexedField") {
            // Items of the form
            // { new CmsField("field_name", "FieldType", something, CmsIndexedField.TYPE) }
            //console.log(`Found field ${object.arguments[0].value} type ${object.arguments[1].value} indexedField ${object.arguments[3].property.name}`);
            return { cmsfield: object.arguments[0].value, type: object.arguments[1].value, indexedField: object.arguments[3].property.name };
        } else {
            // Items of the form
            // { new CmsField("field_name", "FieldType") }
            //console.log(`Found field ${object.arguments[0].value} type ${object.arguments[1].value}`);
            return { cmsfield: object.arguments[0].value, type: object.arguments[1].value };
        }
    }
    else if (object.type === "JSXEmptyExpression"
        && object.innerComments && object.innerComments.length > 0
        && object.innerComments[0].type === "CommentBlock"
        && (reComponentType1.test(object.innerComments[0].value)
            || reComponentType2.test(object.innerComments[0].value)
            || reComponentType3.test(object.innerComments[0].value)
            || reComponentType4.test(object.innerComments[0].value))
        ) {
        let match = reComponentType1.exec(object.innerComments[0].value);
        if (match) {
            // Items of the form
            // { /*this.field_name*/ }
            //console.log(`Found /* this.${match[1]} */`);
            return { thisproperty: match[1], comment: true };
        }
        match = reComponentType2.exec(object.innerComments[0].value);
        if (match) {
            // Items of the form
            // { /*this["field_name"]*/ }
            //console.log(`Found /* this[\"${match[2]}\"] */`);
            return { thisproperty: match[2], comment: true };
        }
        match = reComponentType3.exec(object.innerComments[0].value);
        if (match) {
            if (match.length > 5) {
                // Items of the form
                // { /*new CmsField("field_name", CmsFieldTypes.FieldType, something, CmsIndexedField.TYPE)*/ }
                //console.log(`Found commented field ${match[2]} type ${match[3]} indexedField ${match[5]}`);
                return { cmsfield: match[2], type: match[3], indexedField: match[5], comment: true };
            } else {
                // Items of the form
                // { /*new CmsField("field_name", CmsFieldTypes.FieldType)*/ }
                //console.log(`Found commented field ${match[2]} type ${match[3]}`);
                return { cmsfield: match[2], type: match[3], comment: true };
            }
        }
        match = reComponentType4.exec(object.innerComments[0].value);
        if (match) {
            if (match.length > 6) {
                // Items of the form
                // { /*new CmsField("field_name", "FieldType", something, CmsIndexedField.TYPE)*/ }
                //console.log(`Found commented field ${match[2]} type ${match[4]} indexedField ${match[6]}`);
                return { cmsfield: match[2], type: match[4], indexedField: match[6], comment: true };
            } else {
                // Items of the form
                // { /*new CmsField("field_name", "FieldType")*/ }
                //console.log(`Found commented field ${match[2]} type ${match[4]}`);
                return { cmsfield: match[2], type: match[4], comment: true };
            }
        }
    }
    // TODO: more complex expressions
    
    const validFields = ["expression","callee","object","arguments"];
    for (let i in validFields) {
        const sub = object[validFields[i]];
        if (sub) {
            if (sub.length && sub.length > 0) {
                for (let j in sub) {
                    let result = processJsxExpressionSub(content, component, sub[j]);
                    if (result) return result;
                }
            } else {
                let result = processJsxExpressionSub(content, component, sub);
                if (result) return result;
            }
        }
    }
    return null;
};

const processJsxElement = (content, component, object, replacements, imports, dependencies) => {
    if (!object || !object.openingElement || !object.openingElement.name
        || !imports.find(i => object.openingElement.name.name === i)) return;
    const componentName = object.openingElement.name.name;
    let suffix = "";
    let previouslyUsed = replacements.filter(r => r.component === componentName);
    if (!previouslyUsed || !previouslyUsed.length) dependencies.push(componentName);
    if (previouslyUsed && previouslyUsed.length > 0) suffix = `_${previouslyUsed.length + 1}`;
    replacements.push({start: object.start, end: object.end, component: componentName, value: `{${componentName}${suffix}:${componentName}}`});
};

const findCmsFieldFromVariable = (content, component, variable, comment) => {
    let result = findCmsFieldFromVariableSub(content, component, variable);
    if (!result || !result.cmsfield) {
        // Fall back to text
        //console.warn(`No definition found for ${variable}, defaulting to text`);
        //result = { cmsfield: variable, type: "TEXT" };
        // Fall back to remove surrounding { and }
        //console.warn(`COMPONENT: ${_componentName} - No definition found for ${variable}, removing { and }`);
        result = {};
    }
    if (comment) result.comment = true;
    return result;
};

const findCmsFieldFromVariableSub = (content, object, variable) => {
    if (object.type === "ExpressionStatement"
        && object.expression && object.expression.type === "AssignmentExpression" && object.expression.operator === "="
        && object.expression.left && object.expression.left.type === "MemberExpression"
        && object.expression.left.object && object.expression.left.object.type === "ThisExpression"
        && object.expression.left.property && object.expression.left.property.type === "Identifier"
        && object.expression.left.property.name === variable
        && object.expression.right && object.expression.right.type === "NewExpression"
        && object.expression.right.callee && object.expression.right.callee.type === "Identifier"&& object.expression.right.callee.name === "CmsField"
        && object.expression.right.arguments && object.expression.right.arguments.length > 1
        && object.expression.right.arguments[0].type === "StringLiteral"
        && object.expression.right.arguments[1].type === "MemberExpression"
        && object.expression.right.arguments[1].object && object.expression.right.arguments[1].object.type === "Identifier" && object.expression.right.arguments[1].object.name === "CmsFieldTypes"
        && object.expression.right.arguments[1].property ) {
        if (object.expression.right.arguments.length > 3
            && object.expression.right.arguments[3].object && object.expression.right.arguments[3].object.type === "Identifier" && object.expression.right.arguments[3].object.name === "CmsIndexedField") {
            // Items of the form
            // this.variable_name = new CmsField("field_name", CmsFieldTypes.FieldType, something, CmsIndexedField.Type);
            //console.log(`Found ${variable} with field name ${object.expression.right.arguments[0].value}, type ${object.expression.right.arguments[1].property.name} and indexedField ${object.expression.right.arguments[3].property.name}`);
            return {cmsfield: object.expression.right.arguments[0].value, type: object.expression.right.arguments[1].property.name, indexedField: object.expression.right.arguments[3].property.name};
        } else {
            // Items of the form
            // this.variable_name = new CmsField("field_name", CmsFieldTypes.FieldType);
            //console.log(`Found ${variable} with field name ${object.expression.right.arguments[0].value} and type ${object.expression.right.arguments[1].property.name}`);
            return {cmsfield: object.expression.right.arguments[0].value, type: object.expression.right.arguments[1].property.name};
        }
    } else if (object.type === "ExpressionStatement"
        && object.expression && object.expression.type === "AssignmentExpression" && object.expression.operator === "="
        && object.expression.left && object.expression.left.type === "MemberExpression"
        && object.expression.left.object && object.expression.left.object.type === "ThisExpression"
        && object.expression.left.property && object.expression.left.property.type === "Identifier"
        && object.expression.left.property.name === variable
        && object.expression.right && object.expression.right.type === "NewExpression"
        && object.expression.right.callee && object.expression.right.callee.type === "Identifier"&& object.expression.right.callee.name === "CmsField"
        && object.expression.right.arguments && object.expression.right.arguments.length > 1
        && object.expression.right.arguments[0].type === "StringLiteral"
        && object.expression.right.arguments[1].type === "StringLiteral") {
        if (object.expression.right.arguments.length > 3
            && object.expression.right.arguments[3].object && object.expression.right.arguments[3].object.type === "Identifier" && object.expression.right.arguments[3].object.name === "CmsIndexedField") {
            // Items of the form
            // this.variable_name = new CmsField("field_name", "FieldType", something, CmsIndexedField.Type);
            //console.log(`Found ${variable} with field name ${object.expression.right.arguments[0].value}, type ${object.expression.right.arguments[1].value} and indexedField ${object.expression.right.arguments[3].property.name}`);
            return {cmsfield: object.expression.right.arguments[0].value, type: object.expression.right.arguments[1].value, indexedField: object.expression.right.arguments[3].property.name};
        } else {
            // Items of the form
            // this.variable_name = new CmsField("field_name", "FieldType");
            //console.log(`Found ${variable} with field name ${object.expression.right.arguments[0].value} and type ${object.expression.right.arguments[1].value}`);
            return {cmsfield: object.expression.right.arguments[0].value, type: object.expression.right.arguments[1].value};
        }
    }

    // Recurse
    const validFields = ["body","expression","callee","object"];
    for (let i in validFields) {
        let sub = object[validFields[i]];
        if (sub) {
            if (!sub.length) sub = [sub];
            for (var j = 0; j < sub.length; j++) {
                let result = findCmsFieldFromVariableSub(content, sub[j], variable);
                if (result) return result;
            }
        }
    }
};


const cmsFieldTypeToString = (cmsFieldType) => {
    if (cmsFieldType === "IMAGE") return "Src";
    if (cmsFieldType === cmsFieldType.toUpperCase()) {
        // TODO: robusify this!
        return cmsFieldType[0] + cmsFieldType.substr(1).toLowerCase();
    }
    return cmsFieldType;
};

const cmsIndexedFieldToString = (cmsIndexedField) => {
    if (!cmsIndexedField || cmsIndexedField === "NONE") return "";
    if (cmsIndexedField === "DATETIME") return "IndexedDateTime";
    if (cmsIndexedField === cmsIndexedField.toUpperCase()) {
        // TODO: robusify this!
        return "Indexed" + cmsIndexedField[0] + cmsIndexedField.substr(1).toLowerCase();
    }
    return "Indexed" + cmsIndexedField;
};

module.exports = {
    parse: parse
};