import { RootEntityType } from '../model';
import { Field } from '../model/implementation';
import { BasicType, BinaryOperationQueryNode, BinaryOperator, ConditionalQueryNode, EntitiesQueryNode, FieldQueryNode, FirstOfListQueryNode, FollowEdgeQueryNode, ListQueryNode, NullQueryNode, ObjectQueryNode, QueryNode, RootEntityIDQueryNode, TransformListQueryNode, TypeCheckQueryNode, VariableQueryNode } from '../query-tree';
import { ID_FIELD } from '../schema/constants';
import { and } from './filter-input-types/constants';

export function createFieldNode(field: Field, sourceNode: QueryNode): QueryNode {
    if (field.isList) {
        if (field.isRelation) {
            return createToNRelationNode(field, sourceNode);
        }

        // there are no lists of references

        return createSafeListQueryNode(new FieldQueryNode(sourceNode, field));
    }

    if (field.isRelation) {
        return createTo1RelationNode(field, sourceNode);
    }

    if (field.isReference) {
        return createTo1ReferenceNode(field, sourceNode);
    }

    if (field.declaringType.isRootEntityType && field.isSystemField && field.name == ID_FIELD) {
        return new RootEntityIDQueryNode(sourceNode);
    }

    const fieldNode = new FieldQueryNode(sourceNode, field);
    if (field.type.isEntityExtensionType) {
        return new ConditionalQueryNode(new TypeCheckQueryNode(fieldNode, BasicType.OBJECT), fieldNode, ObjectQueryNode.EMPTY);
    }

    return fieldNode;
}

function createTo1ReferenceNode(field: Field, sourceNode: QueryNode): QueryNode {
    const referencedEntityType = field.type as RootEntityType;
    const keyFieldInReferencedEntity = referencedEntityType.getKeyFieldOrThrow();

    const referenceKeyNode = new FieldQueryNode(sourceNode, field);
    const listItemVar = new VariableQueryNode(field.name);
    const itemKeyNode = createFieldNode(keyFieldInReferencedEntity, listItemVar);
    const equalFilterNode = new BinaryOperationQueryNode(
        itemKeyNode,
        BinaryOperator.EQUAL,
        referenceKeyNode
    );
    // this is a hint for the database that we're not interested in items where the key is null so it can use sparse
    // indices. this is used by arangodb >= 3.4. It would be preferable to implement this in the ArangoDBAdapter, but
    // then we would need a way to convey non-nullness somehow.
    const nonNullFilterNode = new BinaryOperationQueryNode(
        itemKeyNode,
        BinaryOperator.UNEQUAL,
        NullQueryNode.NULL
    );
    const filterNode = and(nonNullFilterNode, equalFilterNode);

    const listNode = new EntitiesQueryNode(referencedEntityType);
    const filteredListNode = new TransformListQueryNode({
        listNode,
        filterNode,
        maxCount: 1,
        itemVariable: listItemVar
    });
    const rawNode = new FirstOfListQueryNode(filteredListNode);
    return new ConditionalQueryNode(new TypeCheckQueryNode(referenceKeyNode, BasicType.NULL), NullQueryNode.NULL, rawNode);
}

function createTo1RelationNode(field: Field, sourceNode: QueryNode): QueryNode {
    const relationSide = field.getRelationSideOrThrow();
    const followNode = new FollowEdgeQueryNode(relationSide, sourceNode);
    return new FirstOfListQueryNode(followNode);
}

function createToNRelationNode(field: Field, sourceNode: QueryNode): QueryNode {
    const relationSide = field.getRelationSideOrThrow();
    return new FollowEdgeQueryNode(relationSide, sourceNode);
}

function createSafeListQueryNode(listNode: QueryNode) {
    // to avoid errors because of eagerly evaluated list expression, we just convert non-lists to an empty list
    return new ConditionalQueryNode(
        new TypeCheckQueryNode(listNode, BasicType.LIST),
        listNode,
        new ListQueryNode([])
    );
}
