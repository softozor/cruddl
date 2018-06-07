import { GraphQLID, GraphQLList, GraphQLNonNull } from 'graphql';
import { flatMap } from 'lodash';
import memorize from 'memorize-decorator';
import { CalcMutationsOperator, ChildEntityType, EntityExtensionType, Field, RootEntityType } from '../../model';
import { CALC_MUTATIONS_OPERATORS, CalcMutationOperator, ID_FIELD } from '../../schema/constants';
import { getUpdateAllInputTypeName, getUpdateInputTypeName } from '../../schema/names';
import { CreateInputTypeGenerator } from '../create-input-types';
import { EnumTypeGenerator } from '../enum-type-generator';
import {
    AddChildEntitiesInputField, BasicListUpdateInputField, BasicUpdateInputField, CalcMutationInputField,
    RemoveChildEntitiesInputField, UpdateChildEntitiesInputField, UpdateEntityExtensionInputField,
    UpdateFilterInputField, UpdateInputField, UpdateValueObjectInputField, UpdateValueObjectListInputField
} from './input-fields';
import {
    UpdateChildEntityInputType, UpdateEntityExtensionInputType, UpdateObjectInputType, UpdateRootEntityInputType
} from './input-types';
import {
    AddEdgesInputField, CreateAndAddEdgesInputField, CreateAndSetEdgeInputField, RemoveEdgesInputField,
    SetEdgeInputField
} from './relation-fields';

export class UpdateInputTypeGenerator {
    constructor(
        private readonly enumTypeGenerator: EnumTypeGenerator,
        private readonly createInputTypeGenerator: CreateInputTypeGenerator
    ) {
    }

    @memorize()
    generate(type: RootEntityType | EntityExtensionType | ChildEntityType): UpdateObjectInputType {
        if (type.isRootEntityType) {
            return this.generateForRootEntityType(type);
        }
        if (type.isEntityExtensionType) {
            return this.generateForEntityExtensionType(type);
        }
        if (type.isChildEntityType) {
            return this.generateForChildEntityType(type);
        }
        throw new Error(`Unsupported type ${(type as any).kind} for update input type generation`);
    }

    @memorize()
    generateForRootEntityType(type: RootEntityType): UpdateRootEntityInputType {
        return new UpdateRootEntityInputType(type, getUpdateInputTypeName(type.name),
            () => flatMap(type.fields, (field: Field) => this.generateFields(field)));
    }

    @memorize()
    generateUpdateAllRootEntitiesInputType(type: RootEntityType): UpdateRootEntityInputType {
        return new UpdateRootEntityInputType(type, getUpdateAllInputTypeName(type.name),
            () => flatMap(type.fields, (field: Field) => this.generateFields(field, {
                skipID: true,
                skipRelations: true // can't do this properly at the moment because it would need a dynamic number of pre-execs
            })));
    }

    @memorize()
    generateForEntityExtensionType(type: EntityExtensionType): UpdateEntityExtensionInputType {
        return new UpdateEntityExtensionInputType(type, getUpdateInputTypeName(type.name),
            () => flatMap(type.fields, (field: Field) => this.generateFields(field)));
    }

    @memorize()
    generateForChildEntityType(type: ChildEntityType): UpdateChildEntityInputType {
        return new UpdateChildEntityInputType(type, getUpdateInputTypeName(type.name),
            () => flatMap(type.fields, (field: Field) => this.generateFields(field)));
    }

    private generateFields(field: Field, {skipID = false, skipRelations = false}: { skipID?: boolean, skipRelations?: boolean } = {}): UpdateInputField[] {
        if (field.isSystemField) {
            if (!skipID && (field.declaringType.isRootEntityType || field.declaringType.isChildEntityType) && field.name == ID_FIELD) {
                // id is always required because it is the filter
                // (unless skipID is true, then we have a special filter argument and can't set the id at all)
                return [new UpdateFilterInputField(field, new GraphQLNonNull(GraphQLID))];
            }
            return [];
        }

        if (field.type.isScalarType || field.type.isEnumType) {
            const inputType = field.type.isEnumType ? this.enumTypeGenerator.generate(field.type) : field.type.graphQLScalarType;
            if (field.isList) {
                // don't allow null values in lists
                return [new BasicListUpdateInputField(field, new GraphQLList(new GraphQLNonNull(inputType)))];
            } else {
                const calcMutationOperators = Array.from(field.calcMutationOperators).map(getCalcMutationOperatorOrThrow);
                const calcMutationFields = calcMutationOperators.map(op => new CalcMutationInputField(field, inputType, op.operator, op.prefix));
                // TODO this implementation does not work with multiple calcMutations or them mixed with a regular set, which worked before
                // Either support this or at least throw an error in this case

                return [
                    new BasicUpdateInputField(field, inputType),
                    ...calcMutationFields
                ];
            }
        }

        if (field.type.isValueObjectType) {
            const inputType = this.createInputTypeGenerator.generate(field.type);
            if (field.isList) {
                return [new UpdateValueObjectListInputField(field, inputType)];
            } else {
                return [new UpdateValueObjectInputField(field, inputType)];
            }
        }

        if (field.type.isEntityExtensionType) {
            const inputType = this.generate(field.type);
            return [new UpdateEntityExtensionInputField(field, inputType)];
        }

        if (field.type.isChildEntityType) {
            return [
                new AddChildEntitiesInputField(field, this.createInputTypeGenerator.generateForChildEntityType(field.type)),
                new UpdateChildEntitiesInputField(field, this.generateForChildEntityType(field.type)),
                new RemoveChildEntitiesInputField(field)
            ];
        }

        if (field.isReference) {
            // we intentionally do not check if the referenced object exists (loose coupling), so this behaves just
            // like a regular field
            return [new BasicUpdateInputField(field, field.type.getKeyFieldTypeOrThrow().graphQLScalarType)];
        }

        if (field.isRelation) {
            if (skipRelations) {
                return [];
            }

            const inputType = this.createInputTypeGenerator.generateForRootEntityType(field.type);
            if (field.isList) {
                return [
                    new AddEdgesInputField(field),
                    new RemoveEdgesInputField(field),
                    new CreateAndAddEdgesInputField(field, inputType)
                ];
            } else {
                return [new SetEdgeInputField(field),
                    new CreateAndSetEdgeInputField(field, inputType)];
            }
        }

        throw new Error(`Field "${field.declaringType.name}.${field.name}" has an unexpected configuration`);
    }
}

function getCalcMutationOperatorOrThrow(operator: CalcMutationsOperator): CalcMutationOperator & { operator: CalcMutationsOperator } {
    const value = CALC_MUTATIONS_OPERATORS.find(op => op.name == operator);
    if (!value) {
        throw new Error(`Calc mutation operator "${operator}" is not defined`);
    }
    return {
        ...value,
        operator
    };
}