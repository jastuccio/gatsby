const report = require(`gatsby-cli/lib/reporter`)
const { ObjectTypeComposer } = require(`graphql-compose`)
const { getExampleObject, isEmpty } = require(`./inference-metadata`)
const { addNodeInterface } = require(`../types/node-interface`)
const { addInferredFields } = require(`./add-inferred-fields`)

const addInferredTypes = ({
  schemaComposer,
  nodeStore,
  typeConflictReporter,
  typeMapping,
  inferenceMetadata,
  parentSpan,
}) => {
  // XXX(freiksenet): Won't be needed after plugins set typedefs
  // Infer File first so all the links to it would work
  const typeNames = putFileFirst(nodeStore.getTypes())
  const noNodeInterfaceTypes = []

  const typesToInfer = []

  typeNames.forEach(typeName => {
    let typeComposer
    if (schemaComposer.has(typeName)) {
      typeComposer = schemaComposer.getOTC(typeName)
      // Infer if we have enabled "@infer" or if it's "@dontInfer" but we
      // have "addDefaultResolvers: true"
      const runInfer = typeComposer.hasExtension(`infer`)
        ? typeComposer.getExtension(`infer`) ||
          typeComposer.getExtension(`addDefaultResolvers`)
        : true
      if (runInfer) {
        if (!typeComposer.hasInterface(`Node`)) {
          noNodeInterfaceTypes.push(typeName)
        }
        typesToInfer.push(typeComposer)
      }
    } else {
      typeComposer = createInferredTypeComposer({ typeName, schemaComposer })
      typesToInfer.push(typeComposer)
    }
  })

  if (noNodeInterfaceTypes.length > 0) {
    noNodeInterfaceTypes.forEach(typeName => {
      report.warn(
        `Type \`${typeName}\` declared in \`createTypes\` looks like a node, ` +
          `but doesn't implement a \`Node\` interface. It's likely that you should ` +
          `add the \`Node\` interface to your type def:\n\n` +
          `\`type ${typeName} implements Node { ... }\`\n\n` +
          `If you know that you don't want it to be a node (which would mean no ` +
          `root queries to retrieve it), you can explicitly disable inference ` +
          `for it:\n\n` +
          `\`type ${typeName} @dontInfer { ... }\``
      )
    })
    report.panic(`Building schema failed`)
  }

  return typesToInfer.map(typeComposer =>
    addInferredType({
      schemaComposer,
      typeComposer,
      nodeStore,
      typeConflictReporter,
      typeMapping,
      parentSpan,
      inferenceMetadata,
    })
  )
}

const addInferredType = ({
  schemaComposer,
  typeComposer,
  nodeStore,
  typeConflictReporter,
  typeMapping,
  inferenceMetadata = {},
  parentSpan,
}) => {
  const typeName = typeComposer.getTypeName()
  const nodes = nodeStore.getNodesByType(typeName)
  // TODO: Move this to where the type is created once we can get
  // node type owner information directly from store
  if (
    typeComposer.getExtension(`createdFrom`) === `inference` &&
    nodes.length > 0
  ) {
    typeComposer.setExtension(`plugin`, nodes[0].internal.owner)
  }

  const exampleValue = getExampleObject({
    ...inferenceMetadata[typeName],
    typeName,
    typeConflictReporter,
  })

  addInferredFields({
    schemaComposer,
    typeComposer,
    nodeStore,
    exampleValue,
    typeMapping,
    parentSpan,
  })
  return typeComposer
}

const isEmptyInferredType = ({ typeComposer, inferenceMetadata }) =>
  typeComposer.getExtension(`createdFrom`) === `inference` &&
  isEmpty(inferenceMetadata[typeComposer.getTypeName()])

const createInferredTypeComposer = ({ typeName, schemaComposer }) => {
  const typeComposer = ObjectTypeComposer.create(typeName, schemaComposer)
  addNodeInterface({ schemaComposer, typeComposer })
  typeComposer.setExtension(`createdFrom`, `inference`)
  return typeComposer
}

const putFileFirst = typeNames => {
  const index = typeNames.indexOf(`File`)
  if (index !== -1) {
    return [`File`, ...typeNames.slice(0, index), ...typeNames.slice(index + 1)]
  } else {
    return typeNames
  }
}

module.exports = {
  addInferredType,
  addInferredTypes,
  createInferredTypeComposer,
  isEmptyInferredType,
}
