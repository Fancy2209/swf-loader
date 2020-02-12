import { assert } from "@awayjs/graphics";



import { Scope } from "./run/Scope";
import { interpreterWriter, executionWriter, sliceArguments } from "./run/writers";
import { AXFunction } from "./run/AXFunction";
import { AXApplicationDomain } from "./run/AXApplicationDomain";
import { HasNext2Info } from "./run/HasNext2Info";
import { AXSecurityDomain } from "./run/AXSecurityDomain";
import { scopeStacks } from "./run/scopeStacks";
import { axEquals } from "./run/axEquals";
import { validateCall } from "./run/validateCall";
import { validateConstruct } from "./run/validateConstruct";
import { axGetDescendants } from "./run/axGetDescendants";
import { checkValue } from "./run/checkValue";
import { axCoerceString } from "./run/axCoerceString";
import { axCheckFilter } from "./run/axCheckFilter";
import { axConvertString } from "./run/axConvertString";
import { axAdd } from "./run/axAdd";
import { axTypeOf } from "./run/axTypeOf";
import { release, notImplemented } from "../base/utilities/Debug";
import { Multiname } from "./abc/lazy/Multiname";
import {  CONSTANT } from "./abc/lazy/CONSTANT";
import {  MethodInfo } from "./abc/lazy/MethodInfo";
import {  MethodBodyInfo } from "./abc/lazy/MethodBodyInfo";
import {  internNamespace } from "./abc/lazy/internNamespace";
import {  NamespaceType } from "./abc/lazy/NamespaceType";
import { Bytecode, getBytecodeName } from "./abc/ops";
import { popManyInto } from "../base/utilities/ArrayUtilities";
import { escapeAttributeValue, escapeElementValue } from "./natives/xml";
import { Errors } from "./errors";
import { getPropertyDescriptor } from "../base/utilities/ObjectUtilities";
import { isValidASValue } from './run/initializeAXBasePrototype';
import { AXClass } from './run/AXClass';
import { axCoerceName } from "./run/axCoerceName";
import { isNumeric } from "../base/utilities";
import { compile, Context } from "./jit";
import { jsGlobal } from '../base/utilities/jsGlobal';

/**
 * Helps the interpreter allocate fewer Scope objects.
 */
export class ScopeStack {
  parent: Scope;
  stack: any [];
  isWith: boolean [];
  scopes: Scope [];
  constructor(parent: Scope) {
    this.parent = parent;
    this.stack = [];
    this.isWith = [];
  }

  public push(object: any, isWith: boolean) {
    this.stack.push(object);
    this.isWith.push(!!isWith);
  }

  public get(index): any {
    return this.stack[index];
  }

  public clear() {
    this.stack.length = 0;
    this.isWith.length = 0;
  }

  public pop() {
    this.isWith.pop();
    this.stack.pop();
    if (this.scopes && this.scopes.length > this.stack.length) {
      this.scopes.length--;
      release || assert(this.scopes.length === this.stack.length);
    }
  }

  public topScope(): Scope {
    if (!this.scopes) {
      if (this.stack.length === 0) {
        return this.parent;
      }
      this.scopes = [];
    }
    var parent = this.parent;
    for (var i = 0; i < this.stack.length; i++) {
      var object = this.stack[i], isWith = this.isWith[i], scope = this.scopes[i];
      if (!scope || scope.parent !== parent || scope.object !== object || scope.isWith !== isWith) {
        scope = this.scopes[i] = new Scope(parent, object, isWith);
      }
      parent = scope;
    }
    return parent;
  }
}


function popNameInto(stack: any [], mn: Multiname, rn: Multiname) {
  rn.resolved = {}
  rn.script = null  
  rn.numeric = false
  rn.id = mn.id;
  rn.kind = mn.kind;
  if (mn.isRuntimeName()) {
    var name = stack.pop();
    // Unwrap content script-created AXQName instances.
    if (name && name.axClass && name.axClass === name.sec.AXQName) {
      name = name.name;
      release || assert(name instanceof Multiname);
      rn.kind = mn.isAttribute() ? CONSTANT.RTQNameLA : CONSTANT.RTQNameL;
      rn.id = name.id;
      rn.name = name.name;
      rn.namespaces = name.namespaces;
      return;
    }
    if (typeof name === "number" || isNumeric(axCoerceName(name))) {
        rn.numeric = true
        rn.numericValue = +(axCoerceName(name))
    }
    rn.name = name;
    rn.id = -1;
  } else {
    rn.name = mn.name;
  }
  if (mn.isRuntimeNamespace()) {
    var ns = stack.pop();
    // Unwrap content script-created AXNamespace instances.
    if (ns._ns) {
      release || assert(ns.sec && ns.axClass === ns.sec.AXNamespace);
      ns = ns._ns;
    }
    rn.namespaces = [ns];
    rn.id = -1;
  } else {
    rn.namespaces = mn.namespaces;
  }
  interpreterWriter && interpreterWriter.greenLn("Name: " + rn.name);
}


export function interpret(methodInfo: MethodInfo, savedScope: Scope, callee: AXFunction) {
    if (methodInfo.compiled == null && methodInfo.error == null) {
        let r = compile(methodInfo)
        if (typeof r === "string") {
            methodInfo.error = r
        } else {
          methodInfo.compiled = r.compiled;
          methodInfo.names = r.names
        }
    }

    return methodInfo.compiled ? methodInfo.compiled(new Context(methodInfo, savedScope, methodInfo.names)) : _interpret(methodInfo, savedScope, callee)
}

class InterpreterFrame {
  public pc: number = 0;
  public code: Uint8Array;
  public body: MethodBodyInfo;
  public stack: any[] = [];
  public locals: any[];
  public scopes: ScopeStack;
  public app: AXApplicationDomain;
  public sec: AXSecurityDomain;

  private hasNext2Infos: HasNext2Info[] = null;

  constructor(receiver: Object, methodInfo: MethodInfo, parentScope: Scope, callArgs: IArguments,
              callee: AXFunction) {
    var body = this.body = methodInfo.getBody();
    this.code = body.code;
    this.scopes = new ScopeStack(parentScope);
    var locals = this.locals = [receiver];

    var app = this.app = methodInfo.abc.applicationDomain;
    var sec = this.sec = app.sec;

    var argCount = callArgs.length;
    var arg;
    for (var i = 0, j = methodInfo.parameters.length; i < j; i++) {
      var p = methodInfo.parameters[i];
      if (i < argCount) {
        arg = callArgs[i];
      } else if (p.hasOptionalValue()) {
        arg = p.getOptionalValue();
      } else {
        arg = undefined;
      }
      var rn = p.getType();
      if (rn && !rn.isAnyName()) {
        var type:AXClass = <AXClass> parentScope.getScopeProperty(rn, true, false);
        if (!type) {
          // During class initialization the class' constructor isn't in scope and can't be
          // resolved as a scope property: trying to do so yields `null`.
          // However, using it as a constructor parameter type *does* work, and correctly
          // applies coercion to the constructor. It's unclear why and how this works in
          // Tamarin, but since it does work, we check for this scenario here and work around it.
          if ('axClass' in receiver && (<any>receiver).axClass.name.matches(rn)) {
            type = (<any>receiver).axClass;
          } else {
            continue;
          }
        }
        if (!release && interpreterWriter) {
          interpreterWriter.writeLn("Coercing argument to type " +
                                    (type.axClass ? type.axClass.name.toFQNString(false) : type));
        }
        arg = type.axCoerce(arg);
      }

      locals.push(arg);
    }

    if (methodInfo.needsRest()) {
      locals.push(sec.createArrayUnsafe(sliceArguments(callArgs, methodInfo.parameters.length)));
    } else if (methodInfo.needsArguments()) {
      var argsArray = sliceArguments(callArgs, 0);
      var argumentsArray = Object.create(sec.argumentsPrototype);
      argumentsArray.value = argsArray;
      argumentsArray.callee = callee;
      argumentsArray.receiver = receiver;
      argumentsArray.methodInfo = methodInfo;
      locals.push(argumentsArray);
      }
  }

  bc(): Bytecode {
    return this.code[this.pc++];
  }

  u30(): number {
    var code = this.code;
    var pc = this.pc;
    var result = code[pc++];
    if (result & 0x80) {
      result = result & 0x7f | code[pc++] << 7;
      if (result & 0x4000) {
        result = result & 0x3fff | code[pc++] << 14;
        if (result & 0x200000) {
          result = result & 0x1fffff | code[pc++] << 21;
          if (result & 0x10000000) {
            result = result & 0x0fffffff | code[pc++] << 28;
            result = result & 0xffffffff;
          }
        }
      }
    }
    this.pc = pc;
    return result >>> 0;
  }

  s24(): number {
    var code = this.code;
    var pc = this.pc;
    var u = code[pc] | (code[pc + 1] << 8) | (code[pc + 2] << 16);
    this.pc = pc + 3;
    return (u << 8) >> 8;
  }

  getHasNext2Info(): HasNext2Info {
    var pc = this.pc;
    var hasNext2Infos = this.hasNext2Infos;
    if (!hasNext2Infos) {
      hasNext2Infos = this.hasNext2Infos = [];
    }
    if (!hasNext2Infos[pc]) {
      hasNext2Infos[pc] = new HasNext2Info(null, 0);
    }
    return hasNext2Infos[pc];
  }
}

function _interpret(methodInfo: MethodInfo, savedScope: Scope, callee: AXFunction) {
  if (methodInfo.error != null)
      console.log("interpret: (" + methodInfo.error + ")")

  return function () {

  var frame = new InterpreterFrame(this, methodInfo, savedScope, arguments, callee);
  var stack = frame.stack;
  var locals = frame.locals;
  var scopes = frame.scopes;
  var sec = frame.sec;
  var abc = methodInfo.abc;

  var rn = new Multiname(abc, 0, null, null, null, null, true);
  var value, object, receiver, a, b, offset, index, result;
  var args = [];
  var argCount = 0;

  var scopeStacksHeight = scopeStacks.length;
  scopeStacks.push(frame.scopes);

  interpretLabel:
  while (true) {
    if (!release && interpreterWriter) {
      interpreterWriter.greenLn("" + frame.pc + ": " + getBytecodeName(frame.code[frame.pc]) + " [" +
                                frame.stack.map(x => stringifyStackEntry(x)).join(", ") + "]");
    }
    try {
      var bc = frame.bc();
      switch (bc) {
        case Bytecode.LABEL:
          continue;
        case Bytecode.THROW:
          throw stack.pop();
        case Bytecode.KILL:
          locals[frame.u30()] = undefined;
          break;
        case Bytecode.IFNLT:
        case Bytecode.IFGE:
          offset = frame.s24();
          if (stack.pop() <= stack.pop()) {
            frame.pc += offset;
          }
          continue;
        case Bytecode.IFNLE:
        case Bytecode.IFGT:
          offset = frame.s24();
          if (stack.pop() < stack.pop()) {
            frame.pc += offset;
          }
          continue;
        case Bytecode.IFNGT:
        case Bytecode.IFLE:
          offset = frame.s24();
          if (stack.pop() >= stack.pop()) {
            frame.pc += offset;
          }
          continue;
        case Bytecode.IFNGE:
        case Bytecode.IFLT:
          offset = frame.s24();
          if (stack.pop() > stack.pop()) {
            frame.pc += offset;
          }
          continue;
        case Bytecode.JUMP:
          frame.pc = frame.s24() + frame.pc;
          continue;
        case Bytecode.IFTRUE:
          offset = frame.s24();
          if (!!stack.pop()) {
            frame.pc += offset;
          }
          continue;
        case Bytecode.IFFALSE:
          offset = frame.s24();
          if (!stack.pop()) {
            frame.pc += offset;
          }
          continue;
        case Bytecode.IFEQ:
          offset = frame.s24();
          if (axEquals(stack.pop(), stack.pop(), sec)) {
            frame.pc += offset;
          }
          continue;
        case Bytecode.IFNE:
          offset = frame.s24();
          if (!axEquals(stack.pop(), stack.pop(), sec)) {
            frame.pc += offset;
          }
          continue;
        case Bytecode.IFSTRICTEQ:
          offset = frame.s24();
          if (stack.pop() === stack.pop()) {
            frame.pc += offset;
          }
          continue;
        case Bytecode.IFSTRICTNE:
          offset = frame.s24();
          if (stack.pop() !== stack.pop()) {
            frame.pc += offset;
          }
          continue;
        case Bytecode.LOOKUPSWITCH:
          var basePC = frame.pc - 1;
          offset = frame.s24();
          var caseCount = frame.u30();
          index = stack.pop();
          if (index <= caseCount) {
            frame.pc += 3 * index; // Jump to case offset.
            offset = frame.s24();
          }
          frame.pc = basePC + offset;
          continue;
        case Bytecode.POPSCOPE:
          scopes.pop();
          break;
        case Bytecode.NEXTNAME:
          stack[stack.length - 2] = sec.box(stack[stack.length - 2]).axNextName(stack.pop());
          break;
        case Bytecode.NEXTVALUE:
          stack[stack.length - 2] = sec.box(stack[stack.length - 2]).axNextValue(stack.pop());
          break;
        case Bytecode.HASNEXT2:
          var hasNext2Info = frame.getHasNext2Info();
          var objectIndex = frame.u30();
          var indexIndex = frame.u30();
          hasNext2Info.next(sec.box(locals[objectIndex]), <number>locals[indexIndex]);
          locals[objectIndex] = hasNext2Info.object;
          locals[indexIndex] = hasNext2Info.index;
          stack.push(!!hasNext2Info.index);
          break;
        case Bytecode.PUSHNULL:
          stack.push(null);
          break;
        case Bytecode.PUSHUNDEFINED:
          stack.push(undefined);
          break;
        case Bytecode.PUSHBYTE:
          stack.push(frame.code[frame.pc++] << 24 >> 24);
          break;
        case Bytecode.PUSHSHORT:
          stack.push(frame.u30() << 16 >> 16);
          break;
        case Bytecode.PUSHSTRING:
          stack.push(abc.getString(frame.u30()));
          break;
        case Bytecode.PUSHINT:
          stack.push(abc.ints[frame.u30()]);
          break;
        case Bytecode.PUSHUINT:
          stack.push(abc.uints[frame.u30()]);
          break;
        case Bytecode.PUSHDOUBLE:
          stack.push(abc.doubles[frame.u30()]);
          break;
        case Bytecode.PUSHTRUE:
          stack.push(true);
          break;
        case Bytecode.PUSHFALSE:
          stack.push(false);
          break;
        case Bytecode.PUSHNAN:
          stack.push(NaN);
          break;
        case Bytecode.POP:
          stack.pop();
          break;
        case Bytecode.DUP:
          stack.push(stack[stack.length - 1]);
          break;
        case Bytecode.SWAP:
          value = stack[stack.length - 1];
          stack[stack.length - 1] = stack[stack.length - 2];
          stack[stack.length - 2] = value;
          break;
        case Bytecode.PUSHSCOPE:
          scopes.push(sec.box(stack.pop()), false);
          break;
        case Bytecode.PUSHWITH:
          scopes.push(sec.box(stack.pop()), true);
          break;
        case Bytecode.PUSHNAMESPACE:
          stack.push(sec.AXNamespace.FromNamespace(abc.getNamespace(frame.u30())));
          break;
        case Bytecode.NEWFUNCTION:
          stack.push(sec.createFunction(abc.getMethodInfo(frame.u30()), scopes.topScope(), true));
          break;
        case Bytecode.CALL:
          popManyInto(stack, frame.u30(), args);
          object = stack.pop();
          value = stack[stack.length - 1];
          validateCall(sec, value, args.length);
          stack[stack.length - 1] = value.axApply(object, args);
          break;
        case Bytecode.CONSTRUCT:
          popManyInto(stack, frame.u30(), args);
          receiver = sec.box(stack[stack.length - 1]);
          validateConstruct(sec, receiver, args.length);
          stack[stack.length - 1] = receiver.axConstruct(args);
          break;
        case Bytecode.RETURNVOID:
          release || assert(scopeStacks.length === scopeStacksHeight + 1);
          scopeStacks.length--;
          return;
        case Bytecode.RETURNVALUE:
          value = stack.pop();
          // TODO: ensure proper unwinding of the scope stack.
          if (methodInfo.returnTypeNameIndex) {
            receiver = methodInfo.getType();
            if (receiver) {
              value = receiver.axCoerce(value);
            }
          }
          release || assert(scopeStacks.length === scopeStacksHeight + 1);
          scopeStacks.length--;
          return value;
        case Bytecode.CONSTRUCTSUPER:
          popManyInto(stack, frame.u30(), args);
          (<any>savedScope.object).superClass.tPrototype.axInitializer.apply(stack.pop(), args);
          break;
        case Bytecode.CONSTRUCTPROP:
          index = frame.u30();
          popManyInto(stack, frame.u30(), args);
          popNameInto(stack, abc.getMultiname(index), rn);
          stack[stack.length - 1] = sec.box(stack[stack.length - 1]).axConstructProperty(rn, args);
          break;
        case Bytecode.CALLPROPLEX:
        case Bytecode.CALLPROPERTY:
        case Bytecode.CALLPROPVOID:
          index = frame.u30();
          popManyInto(stack, frame.u30(), args);
          popNameInto(stack, abc.getMultiname(index), rn);
          result = sec.box(stack[stack.length - 1]).axCallProperty(rn, args, bc === Bytecode.CALLPROPLEX);
          if (bc === Bytecode.CALLPROPVOID) {
            stack.length--;
          } else {
            stack[stack.length - 1] = result;
          }
          break;
        case Bytecode.CALLSUPER:
        case Bytecode.CALLSUPERVOID:
          index = frame.u30();
          popManyInto(stack, frame.u30(), args);
          popNameInto(stack, abc.getMultiname(index), rn);
          result = sec.box(stack[stack.length - 1]).axCallSuper(rn, savedScope, args);
          if (bc === Bytecode.CALLSUPERVOID) {
            stack.length--;
          } else {
            stack[stack.length - 1] = result;
          }
          break;
        //case Bytecode.CALLSTATIC:
        //  index = frame.u30();
        //  argCount = frame.u30();
        //  popManyInto(stack, argCount, args);
        //  value = abc.getMetadataInfo(index);
        //  var receiver = box(stack[stack.length - 1]);
        //  stack.push(value.axApply(receiver, args));
        //  break;
        case Bytecode.APPLYTYPE:
          popManyInto(stack, frame.u30(), args);
          stack[stack.length - 1] = sec.applyType(stack[stack.length - 1], args);
          break;
        case Bytecode.NEWOBJECT:
          object = Object.create(sec.AXObject.tPrototype);
          argCount = frame.u30();
          // For LIFO-order iteration to be correct, we have to add items highest on the stack
          // first.
          for (var i = stack.length - argCount * 2; i < stack.length; i += 2) {
            value = stack[i + 1];
            object.axSetPublicProperty(stack[i], value);
          }
          stack.length -= argCount * 2;
          stack.push(object);
          break;
        case Bytecode.NEWARRAY:
          object = [];
          argCount = frame.u30();
          for (var i = stack.length - argCount; i < stack.length; i++) {
            object.push(stack[i]);
          }
          stack.length -= argCount;
          stack.push(sec.AXArray.axBox(object));
          break;
        case Bytecode.NEWACTIVATION:
          stack.push(sec.createActivation(methodInfo, scopes.topScope()));
          break;
        case Bytecode.NEWCLASS:
          // Storing super class in `value` to make exception handling easier.
          value = stack[stack.length - 1];
          stack[stack.length - 1] = sec.createClass(abc.classes[frame.u30()], value, scopes.topScope());
          break;
        case Bytecode.GETDESCENDANTS:
          popNameInto(stack, abc.getMultiname(frame.u30()), rn);
          if (rn.name === undefined)
            rn.name = '*';
          stack[stack.length - 1] = axGetDescendants(stack[stack.length - 1], rn, sec);
          break;
        case Bytecode.NEWCATCH:
          stack.push(sec.createCatch(frame.body.catchBlocks[frame.u30()], scopes.topScope()));
          break;
        case Bytecode.FINDPROPERTY:
        case Bytecode.FINDPROPSTRICT:
          popNameInto(stack, abc.getMultiname(frame.u30()), rn);
          stack.push(scopes.topScope().findScopeProperty(rn, bc === Bytecode.FINDPROPSTRICT, false));
          break;
        case Bytecode.GETLEX:
          popNameInto(stack, abc.getMultiname(frame.u30()), rn);
          stack.push(scopes.topScope().findScopeProperty(rn, true, false).axGetProperty(rn));
          break;
        case Bytecode.INITPROPERTY:
        case Bytecode.SETPROPERTY:
          value = stack.pop();
          popNameInto(stack, abc.getMultiname(frame.u30()), rn);
          sec.box(stack.pop()).axSetProperty(rn, value, Bytecode.INITPROPERTY, methodInfo);
          break;
        case Bytecode.GETPROPERTY:
          popNameInto(stack, abc.getMultiname(frame.u30()), rn);
          stack[stack.length - 1] = sec.box(stack[stack.length - 1]).axGetProperty(rn);
          break;
        case Bytecode.DELETEPROPERTY:
          popNameInto(stack, abc.getMultiname(frame.u30()), rn);
          stack[stack.length - 1] = sec.box(stack[stack.length - 1]).axDeleteProperty(rn);
          break;
        case Bytecode.GETSUPER:
          popNameInto(stack, abc.getMultiname(frame.u30()), rn);
          stack[stack.length - 1] = sec.box(stack[stack.length - 1]).axGetSuper(rn, savedScope);
          break;
        case Bytecode.SETSUPER:
          value = stack.pop();
          popNameInto(stack, abc.getMultiname(frame.u30()), rn);
          sec.box(stack.pop()).axSetSuper(rn, savedScope, value);
          break;
        case Bytecode.GETLOCAL:
          stack.push(locals[frame.u30()]);
          break;
        case Bytecode.SETLOCAL:
          locals[frame.u30()] = stack.pop();
          break;
        case Bytecode.GETGLOBALSCOPE:
          stack.push(savedScope.global.object);
          break;
        case Bytecode.GETSCOPEOBJECT:
          stack.push(scopes.get(frame.code[frame.pc++]));
          break;
        case Bytecode.GETSLOT:
          stack[stack.length - 1] = sec.box(stack[stack.length - 1]).axGetSlot(frame.u30());
          break;
        case Bytecode.SETSLOT:
          value = stack.pop();
          sec.box(stack.pop()).axSetSlot(frame.u30(), value);
          break;
        case Bytecode.GETGLOBALSLOT:
          stack[stack.length - 1] = savedScope.global.object.axGetSlot(frame.u30());
          break;
        case Bytecode.SETGLOBALSLOT:
          value = stack.pop();
          savedScope.global.object.axSetSlot(frame.u30(), value);
          break;
        case Bytecode.ESC_XATTR:
          stack[stack.length - 1] = escapeAttributeValue(stack[stack.length - 1]);
          break;
        case Bytecode.ESC_XELEM:
          stack[stack.length - 1] = escapeElementValue(sec, stack[stack.length - 1]);
          break;
        case Bytecode.COERCE_I:
        case Bytecode.CONVERT_I:
          stack[stack.length - 1] |= 0;
          break;
        case Bytecode.COERCE_U:
        case Bytecode.CONVERT_U:
          stack[stack.length - 1] >>>= 0;
          break;
        case Bytecode.COERCE_D:
        case Bytecode.CONVERT_D:
          stack[stack.length - 1] = +stack[stack.length - 1];
          break;
        case Bytecode.COERCE_B:
        case Bytecode.CONVERT_B:
          stack[stack.length - 1] = !!stack[stack.length - 1];
          break;
        case Bytecode.COERCE_S:
          stack[stack.length - 1] = axCoerceString(stack[stack.length - 1]);
          break;
        case Bytecode.CONVERT_S:
          stack[stack.length - 1] = axConvertString(stack[stack.length - 1]);
          break;
        case Bytecode.CHECKFILTER:
          stack[stack.length - 1] = axCheckFilter(sec, stack[stack.length - 1]);
          break;
        case Bytecode.COERCE:
          popNameInto(stack, abc.getMultiname(frame.u30()), rn);
          stack[stack.length - 1] = (<AXClass> scopes.topScope().getScopeProperty(rn, true, false)).axCoerce(stack[stack.length - 1]);
          break;
        case Bytecode.COERCE_A: /* NOP */
          break;
        case Bytecode.ASTYPE:
          popNameInto(stack, abc.getMultiname(frame.u30()), rn);
          stack[stack.length - 1] = (<AXClass> scopes.topScope().getScopeProperty(rn, true, false)).axAsType(stack[stack.length - 1]);
          break;
        case Bytecode.ASTYPELATE:
          stack[stack.length - 2] = stack.pop().axAsType(stack[stack.length - 1]);
          break;
        case Bytecode.COERCE_O:
          object = stack[stack.length - 1];
          stack[stack.length - 1] = object == undefined ? null : object;
          break;
        case Bytecode.NEGATE:
          stack[stack.length - 1] = -stack[stack.length - 1];
          break;
        case Bytecode.INCREMENT:
          ++stack[stack.length - 1];
          break;
        case Bytecode.INCLOCAL:
          ++(<number []>locals)[frame.u30()];
          break;
        case Bytecode.DECREMENT:
          --stack[stack.length - 1];
          break;
        case Bytecode.DECLOCAL:
          --(<number []>locals)[frame.u30()];
          break;
        case Bytecode.TYPEOF:
          stack[stack.length - 1] = axTypeOf(stack[stack.length - 1], sec);
          break;
        case Bytecode.NOT:
          stack[stack.length - 1] = !stack[stack.length - 1];
          break;
        case Bytecode.BITNOT:
          stack[stack.length - 1] = ~stack[stack.length - 1];
          break;
        case Bytecode.ADD:
          b = stack.pop();
          a = stack[stack.length - 1];
          if (typeof a === "number" && typeof b === "number") {
            stack[stack.length - 1] = a + b;
          } else {
            stack[stack.length - 1] = axAdd(a, b, sec);
          }
          break;
        case Bytecode.SUBTRACT:
          stack[stack.length - 2] -= stack.pop();
          break;
        case Bytecode.MULTIPLY:
          stack[stack.length - 2] *= stack.pop();
          break;
        case Bytecode.DIVIDE:
          stack[stack.length - 2] /= stack.pop();
          break;
        case Bytecode.MODULO:
          stack[stack.length - 2] %= stack.pop();
          break;
        case Bytecode.LSHIFT:
          stack[stack.length - 2] <<= stack.pop();
          break;
        case Bytecode.RSHIFT:
          stack[stack.length - 2] >>= stack.pop();
          break;
        case Bytecode.URSHIFT:
          stack[stack.length - 2] >>>= stack.pop();
          break;
        case Bytecode.BITAND:
          stack[stack.length - 2] &= stack.pop();
          break;
        case Bytecode.BITOR:
          stack[stack.length - 2] |= stack.pop();
          break;
        case Bytecode.BITXOR:
          stack[stack.length - 2] ^= stack.pop();
          break;
        case Bytecode.EQUALS:
          stack[stack.length - 2] = axEquals(stack[stack.length - 2], stack.pop(), sec);
          break;
        case Bytecode.STRICTEQUALS:
          stack[stack.length - 2] = stack[stack.length - 2] === stack.pop();
          break;
        case Bytecode.LESSTHAN:
          stack[stack.length - 2] = stack[stack.length - 2] < stack.pop();
          break;
        case Bytecode.LESSEQUALS:
          stack[stack.length - 2] = stack[stack.length - 2] <= stack.pop();
          break;
        case Bytecode.GREATERTHAN:
          stack[stack.length - 2] = stack[stack.length - 2] > stack.pop();
          break;
        case Bytecode.GREATEREQUALS:
          stack[stack.length - 2] = stack[stack.length - 2] >= stack.pop();
          break;
        case Bytecode.INSTANCEOF:
          stack[stack.length - 2] = stack.pop().axIsInstanceOf(stack[stack.length - 1]);
          break;
        case Bytecode.ISTYPE:
          popNameInto(stack, abc.getMultiname(frame.u30()), rn);
          stack[stack.length - 1] = (<AXClass> scopes.topScope().findScopeProperty(rn, true, false)).axIsType(stack[stack.length - 1]);
          break;
        case Bytecode.ISTYPELATE:
          stack[stack.length - 2] = stack.pop().axIsType(stack[stack.length - 1]);
          break;
        case Bytecode.IN:
          receiver = sec.box(stack.pop());
          var name = stack[stack.length - 1];
          stack[stack.length - 1] = (name && name.axClass === sec.AXQName)? receiver.axHasProperty(name.name) : receiver.axHasPublicProperty(name);
          break;
        case Bytecode.INCREMENT_I:
          stack[stack.length - 1] = (stack[stack.length - 1] | 0) + 1;
          break;
        case Bytecode.DECREMENT_I:
          stack[stack.length - 1] = (stack[stack.length - 1] | 0) - 1;
          break;
        case Bytecode.INCLOCAL_I:
          index = frame.u30();
          (<number []>locals)[index] = ((<number []>locals)[index] | 0) + 1;
          break;
        case Bytecode.DECLOCAL_I:
          index = frame.u30();
          (<number []>locals)[index] = ((<number []>locals)[index] | 0) - 1;
          break;
        case Bytecode.NEGATE_I:
          stack[stack.length - 1] = -(stack[stack.length - 1] | 0);
          break;
        case Bytecode.ADD_I:
          stack[stack.length - 2] = (stack[stack.length - 2]|0) + (stack.pop()|0) | 0;
          break;
        case Bytecode.SUBTRACT_I:
          stack[stack.length - 2] = (stack[stack.length - 2]|0) - (stack.pop()|0) | 0;
          break;
        case Bytecode.MULTIPLY_I:
          stack[stack.length - 2] = (stack[stack.length - 2]|0) * (stack.pop()|0) | 0;
          break;
        case Bytecode.GETLOCAL0:
          stack.push(locals[0]);
          break;
        case Bytecode.GETLOCAL1:
          stack.push(locals[1]);
          break;
        case Bytecode.GETLOCAL2:
          stack.push(locals[2]);
          break;
        case Bytecode.GETLOCAL3:
          stack.push(locals[3]);
          break;
        case Bytecode.SETLOCAL0:
          locals[0] = stack.pop();
          break;
        case Bytecode.SETLOCAL1:
          locals[1] = stack.pop();
          break;
        case Bytecode.SETLOCAL2:
          locals[2] = stack.pop();
          break;
        case Bytecode.SETLOCAL3:
          locals[3] = stack.pop();
          break;
        case Bytecode.DXNS:
          scopes.topScope().defaultNamespace = internNamespace(NamespaceType.Public, abc.getString(frame.u30()));
          break;
        case Bytecode.DXNSLATE:
          scopes.topScope().defaultNamespace = internNamespace(NamespaceType.Public, stack.pop());
          break;
        case Bytecode.DEBUG:
          frame.pc ++; frame.u30();
          frame.pc ++; frame.u30();
          break;
        case Bytecode.DEBUGLINE:
        case Bytecode.DEBUGFILE:
          frame.u30();
          break;
        case Bytecode.NOP:
        case Bytecode.BKPT:
          break;
        default:
          notImplemented(getBytecodeName(bc));
      }
    } catch (e) {
      // TODO: e = translateError(e);

      // All script exceptions must be primitive or have a security domain, if they don't then
      // this must be a VM exception.
      if (!isValidASValue(e)) {
        // We omit many checks in the interpreter loop above to keep the code small. These
        // checks can be done after the fact here by turning the VM-internal exception into a
        // proper error according to the current operation.
        e = createValidException(sec, e, bc, value, receiver, a, b, rn, scopeStacksHeight + 1);
      }

      var catchBlocks = frame.body.catchBlocks;
      for (var i = 0; i < catchBlocks.length; i++) {
        var handler = catchBlocks[i];
        if (frame.pc >= handler.start && frame.pc <= handler.end) {
          var typeName = handler.getType();
          if (!typeName || frame.app.getClass(typeName).axIsType(e)) {
            stack.length = 0;
            stack.push(e);
            scopes.clear();
            frame.pc = handler.target;
            continue interpretLabel;
          }
        }
      }

      release || assert(scopeStacks.length === scopeStacksHeight + 1);
      scopeStacks.length--;
      throw e;
    }
  }
}
}

function createValidException(sec: AXSecurityDomain, internalError, bc: Bytecode,
                              value: any, receiver: any, a: any, b: any, mn: Multiname,
                              expectedScopeStacksHeight: number) {
  var isProperErrorObject = internalError instanceof Error &&
                            typeof internalError.name === 'string' &&
                            typeof internalError.message === 'string';
  if (isProperErrorObject) {
    if (internalError instanceof RangeError || internalError.name === 'InternalError') {
      var obj = Object.create(sec.AXError.tPrototype);
      obj._errorID = 1023;
      // Stack exhaustion errors are annoying to catch: Identifying them requires
      // pattern-matching of error messages, and throwing them must be done very
      // carefully to not cause the next one.
      if (internalError.message === 'allocation size overflow') {
        obj.$Bgmessage = "allocation size overflow";
        return obj;
      }
      if (internalError.message.indexOf('recursion') > -1 ||
          internalError.message.indexOf('call stack size exceeded') > -1)
      {
        obj.$Bgmessage = "Stack overflow occurred";
        scopeStacks.length = expectedScopeStacksHeight;
        return obj;
      }
    } else if (internalError instanceof TypeError) {
      if (internalError.message.indexOf("convert") > -1 &&
          (internalError.message.indexOf("to primitive") > -1 ||
            internalError.message.indexOf("to string") > -1)) {
        return sec.createError('TypeError', Errors.ConvertToPrimitiveError, 'value');
      }
      // Internal error thrown by generic Array methods.
      if (internalError.message === 'Conversion to Array failed') {
        return sec.createError('TypeError', Errors.CheckTypeFailedError, 'value', 'Array');
      }
    }
  }

  var message: string;
  var isSuper = false;
  switch (bc) {
    case Bytecode.CALL:
      if (!value || !value.axApply) {
        return sec.createError('TypeError', Errors.CallOfNonFunctionError, 'value');
      }
      break;
    case Bytecode.CONSTRUCT:
      if (!receiver || !receiver.axConstruct) {
        return sec.createError('TypeError', Errors.ConstructOfNonFunctionError);
      }
      break;
    case Bytecode.NEWCLASS:
      if (!value || !sec.AXClass.axIsType(value)) {
        return sec.createError('VerifyError', Errors.InvalidBaseClassError);
      }
      break;
    case Bytecode.CALLSUPERVOID:
    case Bytecode.CONSTRUCTSUPER:
      isSuper = true;
      // Fallthrough.
    case Bytecode.CALLPROPERTY:
    case Bytecode.CALLPROPVOID:
    case Bytecode.CALLPROPLEX:
    case Bytecode.CONSTRUCTPROP:
    case Bytecode.CALLSUPER:
      if (receiver === null) {
        return sec.createError('TypeError', Errors.ConvertNullToObjectError);
      }
      if (receiver === undefined) {
        return sec.createError('TypeError', Errors.ConvertUndefinedToObjectError);
      }
      if (!(receiver.axResolveMultiname(mn) in receiver)) {
        var axClass = isSuper ? receiver.axClass.superClass : receiver.axClass;
        if (axClass.classInfo.instanceInfo.isSealed()) {
          return sec.createError('ReferenceError', Errors.ReadSealedError, mn.name,
                                  axClass.name.toFQNString(false));
        }
        return sec.createError('TypeError', isSuper ?
                                            Errors.ConstructOfNonFunctionError :
                                            Errors.CallOfNonFunctionError, mn.name);
      }
      if (isProperErrorObject && internalError.name === 'RangeError' &&
          (internalError.message.indexOf('arguments array passed') > -1 ||
            internalError.message.indexOf('call stack size') > -1)) {
        return sec.createError('RangeError', Errors.StackOverflowError);
      }
      break;
    case Bytecode.GETSUPER:
      isSuper = true;
      // Fallthrough.
    case Bytecode.GETPROPERTY:
      if (receiver === null) {
        return sec.createError('TypeError', Errors.ConvertNullToObjectError);
      }
      if (receiver === undefined) {
        return sec.createError('TypeError', Errors.ConvertUndefinedToObjectError);
      }
      break;
    case Bytecode.INITPROPERTY:
    case Bytecode.SETPROPERTY:
      if (receiver === null) {
        return sec.createError('TypeError', Errors.ConvertNullToObjectError);
      }
      if (receiver === undefined) {
        return sec.createError('TypeError', Errors.ConvertUndefinedToObjectError);
      }
      var nm = receiver.axResolveMultiname(mn);
      if (nm in receiver && getPropertyDescriptor(receiver, nm).writable === false) {
        return sec.createError('ReferenceError', Errors.ConstWriteError, nm,
                                receiver.axClass.name.name);
      }
      break;
    case Bytecode.INSTANCEOF:
      if (!receiver || !receiver.axIsInstanceOf) {
        return sec.createError('TypeError', Errors.CantUseInstanceofOnNonObjectError);
      }
      break;
    case Bytecode.ASTYPE:
    case Bytecode.ASTYPELATE:
      // ASTYPE(LATE) have almost the same error messages as ISTYPE(LATE), but not *quite*.
      if (receiver && !receiver.axAsType) {
        return sec.createError('TypeError', Errors.ConvertNullToObjectError);
      }
      // Fallthrough.
    case Bytecode.ISTYPE:
    case Bytecode.ISTYPELATE:
      if (receiver === null) {
        return sec.createError('TypeError', Errors.ConvertNullToObjectError);
      }
      if (receiver === undefined) {
        return sec.createError('TypeError', Errors.ConvertUndefinedToObjectError);
      }
      if (!receiver.axIsType) {
        return sec.createError('TypeError', Errors.IsTypeMustBeClassError);
      }
      break;
    case Bytecode.COERCE:
      if (!receiver) {
        return sec.createError('ReferenceError', Errors.ClassNotFoundError,
                                mn.toFQNString(false));
      }
      break;
    case Bytecode.IN:
      if (receiver === null) {
        return sec.createError('TypeError', Errors.ConvertNullToObjectError);
      }
      if (receiver === undefined) {
        return sec.createError('TypeError', Errors.ConvertUndefinedToObjectError);
      }
      break;
    case Bytecode.IFEQ:
    case Bytecode.IFNE:
    case Bytecode.EQUALS:
      if (typeof a !== typeof b) {
        if (typeof a === 'object' && a && typeof b !== 'object' ||
            typeof b === 'object' && b && typeof a !== 'object') {
          return sec.createError('TypeError', Errors.ConvertToPrimitiveError, 'Object');
        }
      }
      break;
    default:
      // Pattern-match some otherwise-annoying-to-convert exceptions. This is all best-effort,
      // so we fail if we're not sure about something.
      if (!internalError || typeof internalError.message !== 'string' ||
          typeof internalError.stack !== 'string' ||
          typeof internalError.name !== 'string') {
        break;
      }
      message = internalError.message;
      var stack = internalError.stack.split('\n');
      var lastFunctionEntry = stack[0].indexOf('at ') === 0 ? stack[0].substr(3) : stack[0];
      switch (internalError.name) {
        case 'TypeError':
          if (lastFunctionEntry.indexOf('AXBasePrototype_valueOf') === 0 ||
              lastFunctionEntry.indexOf('AXBasePrototype_toString') === 0)
          {
            return sec.createError('TypeError', Errors.CallOfNonFunctionError, 'value');
          }
      }
  }
  // To be sure we don't let VM exceptions flow into the player, box them manually here,
  // even in release builds.
  message = 'Uncaught VM-internal exception during op ' + getBytecodeName(bc) + ': ';
  var stack;
  try {
    message += internalError.toString();
    stack = internalError.stack;
  } catch (e) {
    message += '[Failed to stringify exception]';
  }
  // In the extension, we can just kill all the things.
  var player = sec['player'];
  console.error(message, '\n', stack);
  if (player) {
    //player.executeFSCommand('quit', [message]);
    //} else if (typeof jsGlobal.quit === 'function') {
    //  jsGlobal.quit();
  }
  // In other packagings, at least throw a valid value.
  return sec.createError('Error', Errors.InternalErrorIV);
}

function stringifyStackEntry(x: any) {
  if (!x || !x.toString) {
    return String(x);
  }
  if (x.$BgtoString && x.$BgtoString.isInterpreted) {
    return '<unprintable ' + (x.axClass ? x.axClass.name.toFQNString(false) : 'object') + '>';
  }
  try {
    return x.toString();
  } catch (e) {
    return '<unprintable ' + (x.axClass ? x.axClass.name.toFQNString(false) : 'object') + '>';
  }
}
