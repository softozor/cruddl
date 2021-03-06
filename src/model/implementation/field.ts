import { FieldDefinitionNode } from 'graphql';
import { CALC_MUTATIONS_OPERATORS } from '../../schema/constants';
import { CalcMutationsOperator, FieldConfig, TypeKind } from '../config';
import { ValidationMessage } from '../validation';
import { ModelComponent, ValidationContext } from '../validation/validation-context';
import { FieldLocalization } from './i18n';
import { Model } from './model';
import { PermissionProfile } from './permission-profile';
import { Relation, RelationSide } from './relation';
import { RolesSpecifier } from './roles-specifier';
import { ObjectType, Type } from './type';

export class Field implements ModelComponent {
    readonly model: Model;
    readonly name: string;
    description: string | undefined;
    readonly astNode: FieldDefinitionNode | undefined;
    readonly isList: boolean;
    readonly isReference: boolean;
    readonly isRelation: boolean;
    readonly defaultValue?: any;
    readonly calcMutationOperators: ReadonlySet<CalcMutationsOperator>;
    readonly roles: RolesSpecifier | undefined;

    /**
     * Indicates if this is an inherent field of the declaring type that will be maintained by the system and thus can
     * only be queried
     */
    readonly isSystemField: boolean;

    constructor(private readonly input: FieldConfig & { isSystemField?: boolean }, public readonly declaringType: ObjectType) {
        this.model = declaringType.model;
        this.name = input.name;
        this.description = input.description;
        this.astNode = input.astNode;
        this.defaultValue = input.defaultValue;
        this.isReference = input.isReference || false;
        this.isRelation = input.isRelation || false;
        this.isList = input.isList || false;
        this.calcMutationOperators = new Set(input.calcMutationOperators || []);
        this.roles = input.permissions && input.permissions.roles ? new RolesSpecifier(input.permissions.roles) : undefined;
        this.isSystemField = input.isSystemField || false;
    }

    /**
     * Indicates if this field can never be set manually (independent of permissions)
     */
    get isReadOnly(): boolean {
        return this.isSystemField;
    }

    public get type(): Type {
        return this.model.getTypeOrFallback(this.input.typeName);
    }

    public get hasValidType(): boolean {
        return !!this.model.getType(this.input.typeName);
    }

    public get hasDefaultValue(): boolean {
        return this.defaultValue !== undefined;
    }

    public get permissionProfile(): PermissionProfile | undefined {
        if (!this.input.permissions || this.input.permissions.permissionProfileName == undefined) {
            return undefined;
        }
        return this.declaringType.namespace.getPermissionProfile(this.input.permissions.permissionProfileName);
    }

    public get inverseOf(): Field | undefined {
        if (this.input.inverseOfFieldName == undefined) {
            return undefined;
        }
        const type = this.type;
        if (!type.isObjectType) {
            return undefined;
        }
        return type.getField(this.input.inverseOfFieldName);
    }

    public get inverseField(): Field | undefined {
        return this.type.isObjectType ? this.type.fields.find(field => field.inverseOf === this) : undefined;
    }

    public get relation(): Relation | undefined {
        const relationSide = this.relationSide;
        if (!relationSide) {
            return undefined;
        }
        return relationSide.relation;
    }

    public get relationSide(): RelationSide | undefined {
        if (!this.isRelation || !this.declaringType.isRootEntityType || !this.type.isRootEntityType) {
            return undefined;
        }
        if (this.inverseOf) {
            // this is the to side
            return new Relation({
                fromType: this.type,
                fromField: this.inverseOf,
                toType: this.declaringType,
                toField: this
            }).toSide;
        } else {
            // this is the from side
            return new Relation({
                fromType: this.declaringType,
                fromField: this,
                toType: this.type,
                toField: this.inverseField
            }).fromSide;
        }
    }

    public getRelationSideOrThrow(): RelationSide {
        if (this.type.kind != TypeKind.ROOT_ENTITY) {
            throw new Error(`Expected "${this.type.name}" to be a root entity, but is ${this.type.kind}`);
        }
        if (this.declaringType.kind != TypeKind.ROOT_ENTITY) {
            throw new Error(`Expected "${this.declaringType.name}" to be a root entity, but is ${this.declaringType.kind}`);
        }
        const relationSide = this.relationSide;
        if (!relationSide) {
            throw new Error(`Expected "${this.declaringType.name}.${this}" to be a relation`);
        }
        return relationSide;
    }

    public getRelationOrThrow(): Relation {
        return this.getRelationSideOrThrow().relation;
    }

    public getLocalization(resolutionOrder: ReadonlyArray<string>): FieldLocalization {
        return this.model.i18n.getFieldLocalization(this, resolutionOrder)
    }

    validate(context: ValidationContext) {
        this.validateName(context);
        this.validateType(context);
        this.validatePermissions(context);
        this.validateRootEntityType(context);
        this.validateEntityExtensionType(context);
        this.validateChildEntityType(context);
        this.validateRelation(context);
        this.validateReference(context);
        this.validateDefaultValue(context);
        this.validateCalcMutations(context);
    }

    private validateName(context: ValidationContext) {
        if (!this.name) {
            context.addMessage(ValidationMessage.error(`Field name is empty.`, this.astNode));
            return;
        }

        // Leading underscores are reserved for internal names, like ArangoDB's _key field
        if (this.name.startsWith('_')) {
            context.addMessage(ValidationMessage.error(`Field names cannot start with an underscore.`, this.astNode));
            return;
        }

        // some naming convention rules

        if (this.name.includes('_')) {
            context.addMessage(ValidationMessage.warn(`Field names should not include underscores.`, this.astNode));
            return;
        }

        if (!this.name.match(/^[a-z]/)) {
            context.addMessage(ValidationMessage.warn(`Field names should start with a lowercase character.`, this.astNode));
        }
    }

    private validateType(context: ValidationContext) {
        if (!this.model.getType(this.input.typeName)) {
            context.addMessage(ValidationMessage.error(`Type "${this.input.typeName}" not found.`, this.input.typeNameAST || this.astNode));
        }
    }

    private validateRootEntityType(context: ValidationContext) {
        // this does not fit anywhere else properly
        if (this.isReference && this.isRelation) {
            context.addMessage(ValidationMessage.error(`@reference and @relation cannot be combined.`, this.astNode));
        }

        if (this.type.kind !== TypeKind.ROOT_ENTITY) {
            return;
        }

        // root entities are not embeddable
        if (!this.isRelation && !this.isReference) {
            if (this.declaringType.kind == TypeKind.VALUE_OBJECT) {
                context.addMessage(ValidationMessage.error(`Type "${this.type.name}" is a root entity type and cannot be embedded. Consider adding @reference.`, this.astNode));
            } else {
                context.addMessage(ValidationMessage.error(`Type "${this.type.name}" is a root entity type and cannot be embedded. Consider adding @reference or @relation.`, this.astNode));
            }
        }
    }

    private validateRelation(context: ValidationContext) {
        if (!this.isRelation) {
            return;
        }

        if (this.declaringType.kind !== TypeKind.ROOT_ENTITY) {
            context.addMessage(ValidationMessage.error(`Relations can only be defined on root entity types. Consider using @reference instead.`, this.astNode));
        }

        // do target type validations only if it resolved correctly
        if (!this.hasValidType) {
            return;
        }

        if (this.type.kind !== TypeKind.ROOT_ENTITY) {
            context.addMessage(ValidationMessage.error(`Type "${this.type.name}" cannot be used with @relation because it is not a root entity type.`, this.astNode));
            return;
        }

        if (this.input.inverseOfFieldName != undefined) {
            const inverseOf = this.type.getField(this.input.inverseOfFieldName);
            const inverseFieldDesc = `Field "${this.type.name}.${this.input.inverseOfFieldName}" used as inverse field of "${this.declaringType.name}.${this.name}"`;
            if (!inverseOf) {
                context.addMessage(ValidationMessage.error(`Field "${this.input.inverseOfFieldName}" does not exist on type "${this.type.name}".`, this.input.inverseOfASTNode || this.astNode));
            } else if (inverseOf.type && inverseOf.type !== this.declaringType) {
                context.addMessage(ValidationMessage.error(`${inverseFieldDesc} has named type "${inverseOf.type.name}" but should be of type "${this.declaringType.name}".`, this.input.inverseOfASTNode || this.astNode));
            } else if (!inverseOf.isRelation) {
                context.addMessage(ValidationMessage.error(`${inverseFieldDesc} does not have the @relation directive.`, this.input.inverseOfASTNode || this.astNode));
            } else if (inverseOf.inverseOf != undefined) {
                context.addMessage(ValidationMessage.error(`${inverseFieldDesc} should not declare inverseOf itself.`, this.input.inverseOfASTNode || this.astNode));
            }
        } else {
            // look for @relation(inverseOf: "thisField") in the target type
            const inverseFields = this.type.fields.filter(field => field.inverseOf === this);
            if (inverseFields.length === 0) {
                // no @relation(inverseOf: "thisField") - should be ok, but is suspicious if there is a matching @relation back to this type
                // (look for inverseOfFieldName instead of inverseOf so that we don't emit this warning if the inverseOf config is invalid)
                const matchingRelation = this.type.fields.find(field => field.isRelation && field.type === this.declaringType && field.input.inverseOfFieldName == undefined);
                if (matchingRelation) {
                    context.addMessage(ValidationMessage.warn(`This field and "${matchingRelation.declaringType.name}.${matchingRelation.name}" define separate relations. Consider using the "inverseOf" argument to add a backlink to an existing relation.`, this.astNode));
                }
            } else if (inverseFields.length > 1) {
                const names = inverseFields.map(f => `"${this.type.name}.${f.name}"`).join(', ');
                // found multiple inverse fields - this is an error
                // check this here and not in the inverse fields so we don't report stuff twice
                for (const inverseField of inverseFields) {
                    context.addMessage(ValidationMessage.error(`Multiple fields (${names}) declare inverseOf to "${this.declaringType.name}.${this.name}".`, inverseField.astNode));
                }
            }
        }
    }

    private validateReference(context: ValidationContext) {
        if (!this.isReference) {
            return;
        }

        // do target type validations only if it resolved correctly
        if (!this.hasValidType) {
            return;
        }

        if (this.type.kind !== TypeKind.ROOT_ENTITY) {
            context.addMessage(ValidationMessage.error(`"${this.type.name}" cannot be used as @reference type because is not a root entity type.`, this.astNode));
            return;
        }

        if (this.isList) {
            context.addMessage(ValidationMessage.error(`@reference is not supported with list types. Consider wrapping the reference in a child entity or value object type.`, this.astNode));
        }

        if (!this.type.keyField) {
            context.addMessage(ValidationMessage.error(`"${this.type.name}" cannot be used as @reference type because it does not have a field annotated with @key.`, this.astNode));
        }
    }

    private validateEntityExtensionType(context: ValidationContext) {
        if (this.type.kind !== TypeKind.ENTITY_EXTENSION) {
            return;
        }

        if (this.declaringType.kind === TypeKind.VALUE_OBJECT) {
            context.addMessage(ValidationMessage.error(`Type "${this.type.name}" is an entity extension type and cannot be used within value object types. Change "${this.declaringType.name}" to an entity extension type or use a value object type for "${this.name}".`, this.astNode));
            return;
        }

        if (this.isList) {
            context.addMessage(ValidationMessage.error(`Type "${this.type.name}" is an entity extension type and cannot be used in a list. Change the field type to "${this.type.name}" (without brackets), or use a child entity or value object type instead.`, this.astNode));
        }
    }

    private validateChildEntityType(context: ValidationContext) {
        if (this.type.kind !== TypeKind.CHILD_ENTITY) {
            return;
        }

        if (this.declaringType.kind === TypeKind.VALUE_OBJECT) {
            context.addMessage(ValidationMessage.error(`Type "${this.type.name}" is a child entity type and cannot be used within value object types. Change "${this.declaringType.name}" to an entity extension type or use a value object type for "${this.name}".`, this.astNode));
            return;
        }

        if (!this.isList) {
            context.addMessage(ValidationMessage.error(`Type "${this.type.name}" is a child entity type and can only be used in a list. Change the field type to "[${this.type.name}]", or use an entity extension or value object type instead.`, this.astNode));
        }
    }

    private validatePermissions(context: ValidationContext) {
        const permissions = this.input.permissions || {};

        if (permissions.permissionProfileName != undefined && permissions.roles != undefined) {
            const message = `Permission profile and explicit role specifiers cannot be combined.`;
            context.addMessage(ValidationMessage.error(message, permissions.permissionProfileNameAstNode || this.input.astNode));
            context.addMessage(ValidationMessage.error(message, permissions.roles.astNode || this.input.astNode));
        }

        if (permissions.permissionProfileName != undefined && !this.declaringType.namespace.getPermissionProfile(permissions.permissionProfileName)) {
            context.addMessage(ValidationMessage.error(`Permission profile "${permissions.permissionProfileName}" not found.`, permissions.permissionProfileNameAstNode || this.input.astNode));
        }

        if (this.roles) {
            this.roles.validate(context);
        }
    }

    private validateDefaultValue(context: ValidationContext) {
        if (this.input.defaultValue === undefined) {
            return;
        }

        if (this.isRelation) {
            context.addMessage(ValidationMessage.error(`Default values are not supported on relations.`, this.input.defaultValueASTNode || this.astNode));
            return;
        }

        context.addMessage(ValidationMessage.info(`Take care, there are no type checks for default values yet.`, this.input.defaultValueASTNode || this.astNode));
    }

    private validateCalcMutations(context: ValidationContext) {
        if (!this.calcMutationOperators.size) {
            return;
        }

        if (this.isList) {
            context.addMessage(ValidationMessage.error(`Calc mutations are not supported on list fields.`, this.astNode));
            return;
        }

        const supportedOperators = CALC_MUTATIONS_OPERATORS.filter(op => op.supportedTypes.includes(this.type.name));
        const supportedOperatorsDesc = supportedOperators.map(op => '"' + op.name + '"').join(', ');

        if (this.calcMutationOperators.size > 0 && !supportedOperators.length) {
            context.addMessage(ValidationMessage.error(`Type "${this.type.name}" does not support any calc mutation operators.`, this.astNode));
            return;
        }

        for (const operator of this.calcMutationOperators) {
            const desc = CALC_MUTATIONS_OPERATORS.find(op => op.name == operator);
            if (!desc) {
                throw new Error(`Unknown calc mutation operator: ${operator}`);
            }

            if (!(desc.supportedTypes.includes(this.type.name))) {
                context.addMessage(ValidationMessage.error(`Calc mutation operator "${operator}" is not supported on type "${this.type.name}" (supported operators: ${supportedOperatorsDesc}).`, this.astNode));
            }
        }
    }
}
