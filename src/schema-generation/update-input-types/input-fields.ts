import { GraphQLInputType, GraphQLList, GraphQLNonNull } from 'graphql';
import { Field } from '../../model';
import { LiteralQueryNode, QueryNode, SetFieldQueryNode } from '../../query-tree';
import { AnyValue } from '../../utils/utils';
import { CreateObjectInputType } from '../create-input-types';
import { TypedInputFieldBase } from '../typed-input-object-type';
import { UpdateObjectInputType } from './input-types';

export interface UpdateInputField extends TypedInputFieldBase<UpdateInputField> {
    getProperties(value: AnyValue, currentEntityNode: QueryNode): ReadonlyArray<SetFieldQueryNode>;

    collectAffectedFields(value: AnyValue, fields: Set<Field>): void;

    appliesToMissingFields(): boolean;
}

export class UpdateFilterInputField implements UpdateInputField {
    constructor(public readonly field: Field, public readonly inputType: GraphQLInputType) {

    }

    get name() {
        return this.field.name;
    }

    appliesToMissingFields() {
        return false;
    }

    getProperties() {
        return [];
    }

    collectAffectedFields() {
        // this field is not updated, so don't put it in here - it will occur as regular read access, though.
        return [];
    }
}

export class BasicUpdateInputField implements UpdateInputField {
    constructor(
        public readonly field: Field,
        public readonly inputType: GraphQLInputType | UpdateObjectInputType
    ) {
    }

    get name() {
        return this.field.name;
    }

    getProperties(value: AnyValue) {
        value = this.coerceValue(value);

        return [
            new SetFieldQueryNode(this.field, new LiteralQueryNode(value))
        ];
    }

    protected coerceValue(value: AnyValue): AnyValue {
        return value;
    }

    collectAffectedFields(value: AnyValue, fields: Set<Field>) {
        fields.add(this.field);
    }

    appliesToMissingFields() {
        return false;
    }
}

export class BasicListUpdateInputField extends BasicUpdateInputField {
    protected coerceValue(value: AnyValue): AnyValue {
        value = super.coerceValue(value);
        if (value === null) {
            // null is not a valid list value - if the user specified it, coerce it to [] to not have a mix of [] and
            // null in the database
            return [];
        }
        return value;
    }
}

export class UpdateValueObjectInputField extends BasicUpdateInputField {
    constructor(
        field: Field,
        public readonly objectInputType: CreateObjectInputType
    ) {
        super(field, objectInputType.getInputType());
    }

    protected coerceValue(value: AnyValue): AnyValue {
        value = super.coerceValue(value);
        if (value == undefined) {
            return value;
        }
        return this.objectInputType.prepareValue(value);
    }

    collectAffectedFields(value: AnyValue, fields: Set<Field>) {
        super.collectAffectedFields(value, fields);
        if (value == undefined) {
            return;
        }

        this.objectInputType.collectAffectedFields(value, fields);
    }
}

export class UpdateValueObjectListInputField extends BasicUpdateInputField {
    constructor(
        field: Field,
        public readonly objectInputType: CreateObjectInputType
    ) {
        super(field, new GraphQLList(new GraphQLNonNull(objectInputType.getInputType())));
    }

    protected coerceValue(value: AnyValue): AnyValue {
        value = super.coerceValue(value);
        if (value === null) {
            // null is not a valid list value - if the user specified it, coerce it to [] to not have a mix of [] and
            // null in the database
            return [];
        }
        if (value === undefined) {
            return undefined;
        }
        if (!Array.isArray(value)) {
            throw new Error(`Expected value for "${this.name}" to be an array, but is "${typeof value}"`);
        }
        return value.map(value => this.objectInputType.prepareValue(value));
    }

    collectAffectedFields(value: AnyValue, fields: Set<Field>) {
        super.collectAffectedFields(value, fields);
        if (value == undefined) {
            return;
        }
        if (!Array.isArray(value)) {
            throw new Error(`Expected value for "${this.name}" to be an array, but is "${typeof value}"`);
        }

        value.forEach(value => this.objectInputType.collectAffectedFields(value, fields));
    }
}
